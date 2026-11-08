import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";

const brDate = (value) => new Date(value).toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short"
});

async function toJpeg(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Selecione uma imagem.");
  const image = await createImageBitmap(file);
  const max = 2400;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Não foi possível converter a foto para JPEG.");
  return blob;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      if (!session?.user) { setProfile(null); setLoading(false); return; }
      setLoading(true);
      const { data, error } = await supabase.from("profiles")
        .select("id, full_name, role").eq("id", session.user.id).single();
      if (!active) return;
      if (error) setError("Não foi possível carregar seu perfil. Confira se o usuário foi cadastrado na tabela profiles.");
      setProfile(data || null);
      setLoading(false);
    }
    loadProfile();
    return () => { active = false; };
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  if (!supabase) return <SetupMessage />;
  if (loading) return <main className="center"><div className="spinner"/><p>Carregando...</p></main>;
  if (!session) return <Login onError={setError} error={error} />;
  if (!profile) return <main className="shell"><Header email={session.user.email} onSignOut={signOut}/><div className="panel"><h2>Perfil não configurado</h2><p>Peça ao administrador para cadastrar seu perfil e sua função no banco de dados.</p>{error && <p className="error">{error}</p>}</div></main>;

  return <main className="shell">
    <Header email={session.user.email} name={profile.full_name} onSignOut={signOut}/>
    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}
    {profile.role === "admin"
      ? <AdminDashboard setError={setError} setNotice={setNotice}/>
      : <DriverUpload user={session.user} setError={setError} setNotice={setNotice}/>}
    <footer>Galvao Logistica · Controle de comprovantes</footer>
  </main>;
}

function SetupMessage() {
  return <main className="center"><section className="panel"><Brand/><h2>Configuração necessária</h2><p>Preencha <code>.env</code> com as credenciais do seu projeto Supabase e reinicie o site.</p></section></main>;
}
function Brand() {
  return <div className="brand"><div className="brandIcon">GL</div><div><strong>GALVAO LOGISTICA</strong><small>CONTROLE DE COMPROVANTES</small></div></div>;
}
function Header({ email, name, onSignOut }) {
  return <header className="topbar"><Brand/><div className="account"><span>{name || email}</span><button className="button ghost" onClick={onSignOut}>Sair</button></div></header>;
}
function Login({ error, onError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e) {
    e.preventDefault();
    onError("");
    setMessage("");
    setRecovering(false);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) onError("E-mail ou senha inválidos. Confira os dados e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function recoverPassword() {
    if (!email) {
      onError("Digite seu e-mail primeiro.");
      return;
    }

    setBusy(true);
    setRecovering(true);
    onError("");
    setMessage("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });

      if (error) {
        onError(error.message);
      } else {
        setMessage("Enviamos um link de recuperação para seu e-mail. Confira também o spam.");
      }
    } finally {
      setBusy(false);
      setRecovering(false);
    }
  }

  return <main className="center"><form className="panel login" onSubmit={submit}>
    <Brand/><h1>Acessar sistema</h1><p className="muted">Entre com seu usuário autorizado.</p>
    <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error && <p className="error">{error}</p>}
    {message && <p className="success">{message}</p>}
    <button className="button primary" disabled={busy}>{busy ? "Aguarde..." : "Entrar"}</button>
    <button type="button" className="button ghost" disabled={busy} onClick={recoverPassword}>
      {recovering ? "Enviando link..." : "Esqueci minha senha"}
    </button>
  </form></main>;
}
function DriverUpload({ user, setError, setNotice }) {
  const [protocol, setProtocol] = useState("");
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(""); setNotice("");
    if (!photo) return setError("Escolha ou tire uma foto do comprovante.");
    setBusy(true);
    try {
      const jpeg = await toJpeg(photo);
      const id = crypto.randomUUID();
      const path = `${user.id}/${id}.jpg`;
      const { error: uploadError } = await supabase.storage.from("comprovantes").upload(path, jpeg, {
        contentType: "image/jpeg", upsert: false
      });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("receipts").insert({
        protocol: protocol.trim(), storage_path: path, driver_id: user.id
      });
      if (insertError) {
        await supabase.storage.from("comprovantes").remove([path]);
        throw insertError;
      }
      setProtocol(""); setPhoto(null);
      e.target.reset();
      setNotice("Comprovante enviado com sucesso!");
    } catch (err) {
      setError(err.message || "Não foi possível enviar o comprovante.");
    } finally { setBusy(false); }
  }
  return <section className="panel narrow">
    <div className="sectionTitle"><div><span className="eyebrow">ÁREA DO MOTOBOY</span><h1>Enviar comprovante</h1></div><span className="pill">Novo envio</span></div>
    <form onSubmit={submit} className="form">
      <label>Número do protocolo<input required value={protocol} onChange={e=>setProtocol(e.target.value)} placeholder="Digite o protocolo"/></label>
      <label>Foto do comprovante<input required type="file" accept="image/*" capture="environment" onChange={e=>setPhoto(e.target.files?.[0] || null)}/><small>A imagem será armazenada em JPEG.</small></label>
      {photo && <p className="muted">Arquivo selecionado: {photo.name}</p>}
      <button className="button primary" disabled={busy}>{busy ? "Enviando foto..." : "Enviar comprovante"}</button>
    </form>
    <p className="muted tiny">A data e o horário são registrados automaticamente pelo sistema.</p>
  </section>;
}
function AdminDashboard({ setError, setNotice }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
  const [day, setDay] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [preview, setPreview] = useState(null);

  async function load() {
    setBusy(true); setError("");
    let query = supabase.from("receipts")
      .select("id, protocol, storage_path, created_at, downloaded_at, profiles:driver_id(full_name)")
      .order("created_at", { ascending: false });
    if (day) {
      const start = new Date(`${day}T00:00:00-03:00`).toISOString();
      const next = new Date(new Date(`${day}T00:00:00-03:00`).getTime() + 86400000).toISOString();
      query = query.gte("created_at", start).lt("created_at", next);
    }
    const { data, error } = await query;
    if (error) setError("Não foi possível carregar os comprovantes.");
    setRows(data || []); setBusy(false);
  }
  useEffect(() => { load(); }, [day]);
  const filtered = useMemo(() => rows.filter(r => {
    const statusOk = filter === "all" || (filter === "pending" ? !r.downloaded_at : !!r.downloaded_at);
    return statusOk && r.protocol.toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search]);
  const pending = rows.filter(r=>!r.downloaded_at).length;
  const downloaded = rows.length - pending;

  async function openReceipt(row) {
    setError("");
    const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(row.storage_path, 60);
    if (error) return setError("Não foi possível abrir a imagem.");
    setPreview({ ...row, url: data.signedUrl });
  }
  async function downloadReceipt(row) {
    setError(""); setNotice("");
    const { data, error } = await supabase.storage.from("comprovantes").download(row.storage_path);
    if (error) return setError("Falha ao baixar o comprovante.");
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = `protocolo-${row.protocol}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    if (!row.downloaded_at) {
      const { error: updateError } = await supabase.from("receipts").update({ downloaded_at: new Date().toISOString() }).eq("id", row.id);
      if (updateError) return setError("O arquivo foi baixado, mas não foi possível atualizar o status.");
      await load();
    }
    setNotice(`Protocolo ${row.protocol} baixado.`);
  }
  async function markPending(row) {
    const { error } = await supabase.from("receipts").update({ downloaded_at: null }).eq("id", row.id);
    if (error) return setError("Não foi possível alterar o status.");
    setNotice(`Protocolo ${row.protocol} voltou para pendente.`); await load();
  }
  return <section className="admin">
    <div className="sectionTitle"><div><span className="eyebrow">PAINEL ADMINISTRATIVO</span><h1>Comprovantes</h1></div><button className="button ghost" onClick={load}>Atualizar</button></div>
    <div className="stats">
      <div className="stat"><strong>{rows.length}</strong><span>Recebidos</span></div>
      <div className="stat"><strong className="green">{downloaded}</strong><span>Baixados</span></div>
      <div className="stat"><strong className="orange">{pending}</strong><span>Pendentes</span></div>
    </div>
    <div className="panel filters">
      <label>Data<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label>
      <label>Buscar protocolo<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Número do protocolo"/></label>
      <div className="tabs">
        <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>Todos</button>
        <button className={filter==="pending"?"active":""} onClick={()=>setFilter("pending")}>Pendentes</button>
        <button className={filter==="done"?"active":""} onClick={()=>setFilter("done")}>Baixados</button>
      </div>
    </div>
    <div className="panel listPanel">
      <div className="listHead"><h2>Lista de entregas</h2><span>{filtered.length} registro(s)</span></div>
      {busy ? <p className="muted">Carregando...</p> : filtered.length === 0 ? <p className="muted empty">Nenhum comprovante encontrado.</p> :
        <div className="tableWrap"><table><thead><tr><th>Protocolo</th><th>Data e hora</th><th>Motoboy</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>{filtered.map(row=><tr key={row.id}>
          <td><strong>{row.protocol}</strong></td><td>{brDate(row.created_at)}</td><td>{row.profiles?.full_name || "—"}</td>
          <td><span className={`status ${row.downloaded_at?"done":"pending"}`}>{row.downloaded_at?"Baixado":"Pendente"}</span></td>
          <td><div className="actions"><button className="button small ghost" onClick={()=>openReceipt(row)}>Ver</button><button className="button small primary" onClick={()=>downloadReceipt(row)}>Baixar JPEG</button>{row.downloaded_at && <button className="button small ghost" onClick={()=>markPending(row)}>Reabrir</button>}</div></td>
        </tr>)}</tbody></table></div>}
    </div>
    {preview && <div className="modal" onClick={()=>setPreview(null)}><div className="modalCard" onClick={e=>e.stopPropagation()}><div className="listHead"><h2>Protocolo {preview.protocol}</h2><button className="button ghost" onClick={()=>setPreview(null)}>Fechar</button></div><img src={preview.url} alt={`Comprovante ${preview.protocol}`}/><button className="button primary" onClick={()=>downloadReceipt(preview)}>Baixar JPEG</button></div></div>}
  </section>;
}