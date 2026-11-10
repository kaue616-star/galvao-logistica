import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase.js";

const brDate = (value) => new Date(value).toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short"
});

async function toJpeg(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Selecione uma imagem.");
  }

  let image;

  try {
    image = await createImageBitmap(file);

    const max = 1600;
    const scale = Math.min(1, max / Math.max(image.width, image.height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível processar a foto.");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.78);
    });

    if (!blob) {
      throw new Error("Não foi possível comprimir a foto.");
    }

    return blob;
  } finally {
    if (image) image.close();
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setError(error.message);
      setSession(data?.session ?? null);
      setLoading(false);
    }).catch((err) => {
      if (mounted) {
        setError(err.message || "Não foi possível conectar ao Supabase.");
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      if (!supabase || !session?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data, error } = await supabase.from("profiles")
        .select("id, full_name, role").eq("id", session.user.id).single();

      if (!active) return;

      if (error) {
        setError("Não foi possível carregar seu perfil. Confira se o usuário foi cadastrado na tabela profiles.");
      }

      setProfile(data || null);
      setLoading(false);
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  if (!supabase) return <SetupMessage />;

  if (loading) {
    return <main className="center"><div className="spinner"/><p>Carregando...</p></main>;
  }

  if (!session) return <Login onError={setError} error={error} />;

  if (!profile) {
    return <main className="shell">
      <Header email={session.user.email} onSignOut={signOut}/>
      <div className="panel">
        <h2>Perfil não configurado</h2>
        <p>Peça ao administrador para cadastrar seu perfil e sua função no banco de dados.</p>
        {error && <p className="error">{error}</p>}
      </div>
    </main>;
  }

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
  return <main className="center">
    <section className="panel">
      <Brand/>
      <h2>Configuração necessária</h2>
      <p>Preencha <code>.env</code> com as credenciais do seu projeto Supabase e reinicie o site.</p>
    </section>
  </main>;
}

function Brand() {
  return <div className="brand">
    <div className="brandIcon">GL</div>
    <div>
      <strong>GALVAO LOGISTICA</strong>
      <small>CONTROLE DE COMPROVANTES</small>
    </div>
  </div>;
}

function Header({ email, name, onSignOut }) {
  return <header className="topbar">
    <Brand/>
    <div className="account">
      <span>{name || email}</span>
      <button className="button ghost" onClick={onSignOut}>Sair</button>
    </div>
  </header>;
}
function Login({ error, onError }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e) {
    e.preventDefault();
    onError("");
    setMessage("");
    setBusy(true);

    try {
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } }
        });

        if (error) throw error;

        if (data.session) {
          setMessage("Cadastro realizado! Seu acesso de motoboy já está ativo.");
        } else {
          setMessage("Cadastro recebido! Confira seu e-mail para confirmar a conta e depois entre no sistema.");
          setMode("login");
          setPassword("");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (error) throw error;
      }
    } catch (err) {
      onError(mode === "register"
        ? (err.message || "Não foi possível realizar o cadastro.")
        : "E-mail ou senha inválidos. Confira os dados e tente novamente.");
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
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin
      });

      if (error) throw error;

      setMessage("Enviamos um link de recuperação para seu e-mail. Confira também o spam.");
    } catch (err) {
      onError(err.message || "Não foi possível enviar o link de recuperação.");
    } finally {
      setBusy(false);
      setRecovering(false);
    }
  }

  return <main className="center">
    <form className="panel login" onSubmit={submit}>
      <Brand/>

      <div className="authTabs">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => {setMode("login");onError("");setMessage("");}}>
          Entrar
        </button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => {setMode("register");onError("");setMessage("");}}>
          Cadastro de motoboy
        </button>
      </div>

      <h1>{mode === "register" ? "Cadastre-se como motoboy" : "Acessar sistema"}</h1>
      <p className="muted">
        {mode === "register" ? "Preencha seus dados para criar seu acesso." : "Entre com seu usuário autorizado."}
      </p>

      {mode === "register" && (
        <label>
          Nome completo
          <input required autoComplete="name" maxLength={120} value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Seu nome completo"/>
        </label>
      )}

      <label>
        E-mail
        <input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com"/>
      </label>

      <label>
        Senha
        <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode === "register" ? "Mínimo de 6 caracteres" : "Sua senha"}/>
      </label>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <button className="button primary" disabled={busy}>
        {busy ? "Aguarde..." : mode === "register" ? "Criar cadastro de motoboy" : "Entrar"}
      </button>

      {mode === "login" && <>
        <button type="button" className="button ghost" disabled={busy} onClick={recoverPassword}>
          {recovering ? "Enviando link..." : "Esqueci minha senha"}
        </button>

        <div className="registerCallout">
          <span>É motoboy e ainda não tem acesso?</span>
          <button type="button" disabled={busy} onClick={() => {setMode("register");onError("");setMessage("");}}>
            Cadastrar como motoboy
          </button>
        </div>
      </>}

      {mode === "register" && (
        <p className="muted tiny">
          O cadastro cria somente um acesso de motoboy. A função de administrador não pode ser escolhida nesta tela.
        </p>
      )}
    </form>
  </main>;
}

function DriverUpload({ user, setError, setNotice }) {
  const [protocol, setProtocol] = useState("");
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (cameraOpen && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOpen, cameraStream]);

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }

    setCameraStream(null);
    setCameraOpen(false);
  }

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  async function openCamera() {
    setError("");
    setNotice("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Seu navegador não permite abrir a câmera nesta página. Confira se está usando o Chrome e se o endereço começa com https://.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });

      setCameraStream(stream);
      setCameraOpen(true);
    } catch (err) {
      setError(err.name === "NotAllowedError"
        ? "Acesso à câmera não permitido. Autorize a câmera nas configurações do Chrome."
        : "Não foi possível abrir a câmera. Confira a permissão e tente novamente.");
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError("A câmera ainda está carregando. Aguarde um instante e tente novamente.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      setError("Não foi possível capturar a imagem. Tente novamente.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Não foi possível preparar a foto. Tente novamente.");
        return;
      }

      const capturedFile = new File([blob], `comprovante-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now()
      });

      setPhoto(capturedFile);
      setError("");
      stopCamera();
    }, "image/jpeg", 0.92);
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!photo) {
      return setError("Tire uma foto ou escolha uma imagem da galeria.");
    }

    setBusy(true);

    try {
      const jpeg = await toJpeg(photo);
      const id = crypto.randomUUID();
      const path = `${user.id}/${id}.jpg`;

      const { error: uploadError } = await supabase.storage.from("comprovantes").upload(path, jpeg, {
        contentType: "image/jpeg",
        upsert: false
      });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("receipts").insert({
        protocol: protocol.trim(),
        storage_path: path,
        driver_id: user.id
      });

      if (insertError) {
        await supabase.storage.from("comprovantes").remove([path]);
        throw insertError;
      }

      setProtocol("");
      setPhoto(null);
      e.target.reset();

      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";

      setNotice("Comprovante enviado com sucesso!");
    } catch (err) {
      setError(err.message || "Não foi possível enviar o comprovante.");
    } finally {
      setBusy(false);
    }
  }

  function handlePhotoChange(e) {
    const selected = e.target.files?.[0] || null;
    if (selected) setPhoto(selected);
  }

  return <section className="panel narrow">
    <div className="sectionTitle">
      <div>
        <span className="eyebrow">ÁREA DO MOTOBOY</span>
        <h1>Enviar comprovante</h1>
      </div>
      <span className="pill">Novo envio</span>
    </div>

    <form onSubmit={submit} className="form">
      <label>
        Número do protocolo
        <input required value={protocol} onChange={e=>setProtocol(e.target.value)} placeholder="Digite o protocolo"/>
      </label>

      <div>
        <label>Foto do comprovante</label>

        <div className="actions">
          <button type="button" className="button primary" disabled={busy || cameraOpen} onClick={openCamera}>
            Abrir câmera
          </button>

          <button type="button" className="button ghost" disabled={busy || cameraOpen} onClick={() => galleryInputRef.current?.click()}>
            Escolher da galeria
          </button>
        </div>

        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          style={{ display: "none" }}
        />

        {cameraOpen && <div style={{ marginTop: 12 }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", maxHeight: 420, background: "#111", borderRadius: 10, objectFit: "contain" }}
          />

          <canvas ref={canvasRef} style={{ display: "none" }} />

          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="button primary" onClick={takePhoto}>
              Tirar foto
            </button>

            <button type="button" className="button ghost" onClick={stopCamera}>
              Cancelar câmera
            </button>
          </div>
        </div>}

        <small>A imagem será armazenada em JPEG.</small>
      </div>

      {photo && <p className="muted">Foto selecionada: {photo.name}</p>}

      <button className="button primary" disabled={busy || cameraOpen}>
        {busy ? "Enviando foto..." : "Enviar comprovante"}
      </button>
    </form>

    <p className="muted tiny">
      A data e o horário são registrados automaticamente pelo sistema.
    </p>
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
    setBusy(true);
    setError("");

    let query = supabase.from("receipts")
      .select("id, protocol, storage_path, created_at, downloaded_at, profiles:driver_id(full_name)")
      .order("created_at", { ascending: false });

    if (day) {
      const start = new Date(`${day}T00:00:00-03:00`).toISOString();
      const next = new Date(
        new Date(`${day}T00:00:00-03:00`).getTime() + 86400000
      ).toISOString();

      query = query.gte("created_at", start).lt("created_at", next);
    }

    const { data, error } = await query;

    if (error) setError("Não foi possível carregar os comprovantes.");

    setRows(data || []);
    setBusy(false);
  }

  useEffect(() => {
    load();
  }, [day]);

  const filtered = useMemo(() => rows.filter(r => {
    const statusOk =
      filter === "all" ||
      (filter === "pending" ? !r.downloaded_at : !!r.downloaded_at);

    return statusOk && r.protocol.toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search]);

  const pending = rows.filter(r => !r.downloaded_at).length;
  const downloaded = rows.length - pending;

  async function openReceipt(row) {
    setError("");

    const { data, error } = await supabase.storage
      .from("comprovantes")
      .createSignedUrl(row.storage_path, 60);

    if (error) return setError("Não foi possível abrir a imagem.");

    setPreview({ ...row, url: data.signedUrl });
  }

  async function downloadReceipt(row) {
    setError("");
    setNotice("");

    const { data, error } = await supabase.storage
      .from("comprovantes")
      .download(row.storage_path);

    if (error) return setError("Falha ao baixar o comprovante.");

    const url = URL.createObjectURL(data);
    const a = document.createElement("a");

    a.href = url;
    a.download = `protocolo-${row.protocol}.jpg`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2000);

    if (!row.downloaded_at) {
      const { error: updateError } = await supabase
        .from("receipts")
        .update({ downloaded_at: new Date().toISOString() })
        .eq("id", row.id);

      if (updateError) {
        return setError("O arquivo foi baixado, mas não foi possível atualizar o status.");
      }

      await load();
    }

    setNotice(`Protocolo ${row.protocol} baixado.`);
  }

  async function markPending(row) {
    const { error } = await supabase
      .from("receipts")
      .update({ downloaded_at: null })
      .eq("id", row.id);

    if (error) return setError("Não foi possível alterar o status.");

    setNotice(`Protocolo ${row.protocol} voltou para pendente.`);
    await load();
  }

  return <section className="admin">
    <div className="sectionTitle">
      <div>
        <span className="eyebrow">PAINEL ADMINISTRATIVO</span>
        <h1>Comprovantes</h1>
      </div>

      <button className="button ghost" onClick={load}>
        Atualizar
      </button>
    </div>

    <div className="stats">
      <div className="stat">
        <strong>{rows.length}</strong>
        <span>Recebidos</span>
      </div>

      <div className="stat">
        <strong className="green">{downloaded}</strong>
        <span>Baixados</span>
      </div>

      <div className="stat">
        <strong className="orange">{pending}</strong>
        <span>Pendentes</span>
      </div>
    </div>

    <div className="panel filters">
      <label>
        Data
        <input type="date" value={day} onChange={e => setDay(e.target.value)}/>
      </label>

      <label>
        Buscar protocolo
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Número do protocolo"/>
      </label>

      <div className="tabs">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          Todos
        </button>

        <button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>
          Pendentes
        </button>

        <button className={filter === "done" ? "active" : ""} onClick={() => setFilter("done")}>
          Baixados
        </button>
      </div>
    </div>

    <div className="panel listPanel">
      <div className="listHead">
        <h2>Lista de entregas</h2>
        <span>{filtered.length} registro(s)</span>
      </div>

      {busy ? (
        <p className="muted">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="muted empty">Nenhum comprovante encontrado.</p>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Data e hora</th>
                <th>Motoboy</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => (
                <tr key={row.id}>
                  <td><strong>{row.protocol}</strong></td>
                  <td>{brDate(row.created_at)}</td>
                  <td>{row.profiles?.full_name || "—"}</td>
                  <td>
                    <span className={`status ${row.downloaded_at ? "done" : "pending"}`}>
                      {row.downloaded_at ? "Baixado" : "Pendente"}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <button className="button small ghost" onClick={() => openReceipt(row)}>
                        Ver
                      </button>

                      <button className="button small primary" onClick={() => downloadReceipt(row)}>
                        Baixar JPEG
                      </button>

                      {row.downloaded_at && (
                        <button className="button small ghost" onClick={() => markPending(row)}>
                          Reabrir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {preview && (
      <div className="modal" onClick={() => setPreview(null)}>
        <div className="modalCard" onClick={e => e.stopPropagation()}>
          <div className="listHead">
            <h2>Protocolo {preview.protocol}</h2>
            <button className="button ghost" onClick={() => setPreview(null)}>
              Fechar
            </button>
          </div>

          <img src={preview.url} alt={`Comprovante ${preview.protocol}`}/>

          <button className="button primary" onClick={() => downloadReceipt(preview)}>
            Baixar JPEG
          </button>
        </div>
      </div>
    )}
  </section>;
}
