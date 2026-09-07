import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowRightArrowLeft,
  faBarcode,
  faBoxOpen,
  faBoxesPacking,
  faCamera,
  faCartPlus,
  faChevronRight,
  faCircleCheck,
  faClipboardList,
  faGear,
  faList,
  faPen,
  faPalette,
  faPlus,
  faRightFromBracket,
  faTrash,
  faWarehouse,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api, post } from "./api";
import "./styles.css";

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      registrations.forEach((registration) => registration.unregister()),
    );
  if ("caches" in window)
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}

type Location = {
  id: number;
  name: string;
  description?: string;
  kind?: "WAREHOUSE" | "UNASSIGNED";
  receivingEnabled?: boolean;
  salesEnabled?: boolean;
};
type Product = {
  id: number;
  name: string;
  brand: string;
  model: string;
  article: string;
  color: string;
  sizes: any[];
  pairsPerBox: number | null;
  salePrice: number | null;
  barcode: string | null;
  internalBarcode?: string;
  internal_barcode?: string;
  total_stock?: number;
  stock?: any[];
  movements?: any[];
  photoUrl?: string | null;
};
const Icon = ({ icon, className }: { icon: any; className?: string }) => (
  <FontAwesomeIcon icon={icon} className={className} />
);
const useBrands = () => {
  const [brands, setBrands] = useState<string[]>([]);
  useEffect(() => {
    api<{ brands: string[] }>("/api/brands")
      .then((r) => setBrands(r.brands))
      .catch(() => setBrands([]));
  }, []);
  return brands;
};
const refocusVideo = async (
  video: HTMLVideoElement | null,
): Promise<boolean> => {
  const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (!track?.applyConstraints) return false;
  const modes = (track.getCapabilities?.() as any)?.focusMode;
  const preferred =
    Array.isArray(modes) && modes.includes("continuous")
      ? "continuous"
      : Array.isArray(modes) && modes.includes("single-shot")
        ? "single-shot"
        : "continuous";
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: preferred } as any],
    });
    return true;
  } catch {
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "single-shot" } as any],
      });
      return true;
    } catch {
      return false;
    }
  }
};
function Scanner({
  onScan,
  variant = "default",
  cameraOpen,
  onCameraChange,
}: {
  onScan: (barcode: string) => void | Promise<void>;
  variant?: "default" | "receive";
  cameraOpen?: boolean;
  onCameraChange?: (open: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const scanQueue = useRef(Promise.resolve());
  const [manual, setManual] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [internalCamera, setInternalCamera] = useState(false);
  const camera = cameraOpen ?? internalCamera;
  const closeCamera = () => {
    onCameraChange?.(false);
    if (cameraOpen === undefined) setInternalCamera(false);
  };
  const [message, setMessage] = useState("Готов к сканированию");
  const last = useRef("");
  useEffect(() => {
    onScanRef.current = (barcode) => {
      scanQueue.current = scanQueue.current
        .then(() => onScan(barcode))
        .catch(() => {});
    };
  }, [onScan]);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let controls: any;
    let alive = true;
    let missedFrames = 0;
    let detectionInProgress = false;
    if (!camera) return;
    const accept = (code: string) => {
      if (!code) {
        missedFrames += 1;
        if (missedFrames >= 4) last.current = "";
        return;
      }
      missedFrames = 0;
      if (code === last.current) return;
      last.current = code;
      onScanRef.current(code);
      navigator.vibrate?.(60);
      setMessage(`Сканирован ${code}`);
    };
    const startZxing = async (element: HTMLVideoElement) => {
      const module = await import("@zxing/browser");
      if (!alive) return;
      const reader = new module.BrowserMultiFormatOneDReader(undefined, {
        delayBetweenScanAttempts: 80,
        delayBetweenScanSuccess: 100,
      });
      controls = await reader.decodeFromVideoElement(element, (result: any) =>
        accept(result?.getText() || ""),
      );
      if (alive) setMessage("Камера включена. Наведите штрихкод в рамку.");
    };
    const start = async () => {
      try {
        if (!window.isSecureContext) {
          setMessage(
            "Для камеры откройте приложение по HTTPS. На телефоне HTTP-адрес камеры не разрешается.",
          );
          closeCamera();
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setMessage(
            "Этот браузер не поддерживает доступ к камере — используйте ручной ввод или Bluetooth-сканер.",
          );
          closeCamera();
          return;
        }
        setMessage("Открываем камеру…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
            focusMode: { ideal: "continuous" } as any,
          },
          audio: false,
        });
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const element = video.current;
        if (!element) throw new Error("Video element unavailable");
        element.srcObject = stream;
        await element.play();
        await refocusVideo(element);
        if (!alive) return;
        const Detector = (window as any).BarcodeDetector;
        try {
          const formats = ["ean_8", "ean_13", "upc_a", "code_128", "code_39"];
          const supported =
            typeof Detector?.getSupportedFormats === "function"
              ? await Detector.getSupportedFormats()
              : formats;
          const available = formats.filter((format) =>
            supported.includes(format),
          );
          if (!Detector || !available.length)
            throw new Error("BarcodeDetector unavailable");
          const detector = new Detector({ formats: available });
          setMessage("Камера включена. Наведите штрихкод в рамку.");
          timer = window.setInterval(async () => {
            if (
              detectionInProgress ||
              !video.current ||
              video.current.readyState < 2
            )
              return;
            detectionInProgress = true;
            try {
              const codes = await detector.detect(video.current);
              accept(codes[0]?.rawValue || "");
            } catch {
              // Keep the camera available when a single frame cannot be read.
            } finally {
              detectionInProgress = false;
            }
          }, 180);
        } catch {
          await startZxing(element);
        }
      } catch (error: any) {
        if (!alive) return;
        const text =
          error?.name === "NotAllowedError"
            ? "Разрешите OpenBoots доступ к камере в настройках браузера."
            : error?.name === "NotFoundError"
              ? "Камера не найдена на устройстве."
              : "Камера недоступна — проверьте HTTPS и разрешение браузера.";
        setMessage(text);
        closeCamera();
      }
    };
    start();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      controls?.stop?.();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camera]);
  useEffect(() => {
    let buffer = "";
    let started = 0;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" && buffer.length >= 4) {
        onScanRef.current(buffer);
        setMessage(`Сканирован ${buffer}`);
        buffer = "";
        return;
      }
      if (e.key.length === 1) {
        if (!started) started = Date.now();
        buffer += e.key;
        if (Date.now() - started > 500) {
          buffer = "";
          started = Date.now();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const manualForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (manual.trim()) onScan(manual.trim());
        setManual("");
      }}
    >
      <input
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        placeholder="Введите штрихкод"
        inputMode="numeric"
      />
      <button className="button" type="submit">
        <Icon icon={faBarcode} />
        Сканировать
      </button>
    </form>
  );
  const toggleCamera = () => {
    const next = !camera;
    onCameraChange?.(next);
    if (cameraOpen === undefined) setInternalCamera(next);
  };
  const controls = variant === "receive" ? (
    <div className="scanner-receive-controls">
      <button className="manual-entry-link" onClick={() => setManualOpen((value) => !value)}>
        Ввести штрихкод вручную
      </button>
      {manualOpen && manualForm}
    </div>
  ) : (
    <div className="scanner-row">
      <button className="button dark" onClick={toggleCamera}>
        <Icon icon={camera ? faXmark : faCamera} />
        {camera ? "Остановить камеру" : "Открыть камеру"}
      </button>
      {manualForm}
    </div>
  );
  return (
    <div className={`scanner ${variant === "receive" ? "scanner--receive" : ""}`}>
      <div
        className={`camera ${camera ? "active" : ""}`}
        onClick={
          camera
            ? async () => {
                const focused = await refocusVideo(video.current);
                setMessage(
                  focused
                    ? "Фокусировка запрошена. Держите код неподвижно."
                    : "Этот браузер управляет фокусом камеры автоматически.",
                );
              }
            : undefined
        }
      >
        {camera ? (
          <video ref={video} muted playsInline />
        ) : (
          <div className="camera-placeholder">
            <Icon icon={faBarcode} />
            <span>Наведите камеру на штрихкод</span>
          </div>
        )}
      </div>
      {controls}
      {message && variant !== "receive" && <small className="muted">{message}</small>}
    </div>
  );
}

const formatMoney = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("uk-UA")} грн`;
function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState("");
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-mark">OB</div>
        <h1>OpenBoots</h1>
        <p className="muted">Склад, который работает со сканера</p>
        <form
          autoComplete="on"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const submittedUsername = String(form.get("username") || "").trim();
            const submittedPassword = String(form.get("password") || "");
            if (!submittedUsername || !submittedPassword) {
              setError("Введите логин и пароль.");
              return;
            }
            try {
              await post("/api/auth/login", {
                username: submittedUsername,
                password: submittedPassword,
              });
              onLogin();
            } catch (err: any) {
              setError(err.message);
            }
          }}
        >
          <label>
            Логин
            <input
              name="username"
              autoComplete="username"
              defaultValue="admin"
              required
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              defaultValue="admin"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="button primary wide" type="submit">
            Войти
          </button>
        </form>
        <small className="muted">Демо-доступ: admin / admin</small>
      </div>
    </main>
  );
}

function ProductCard({
  product,
  onSelect,
}: {
  product: Product;
  onSelect?: (p: Product) => void;
}) {
  const stock = product.stock?.filter((item: any) => item.quantity > 0) || [];
  return (
    <button className="product-card" onClick={() => onSelect?.(product)}>
      <div className="product-card-info">
        <b>
          {product.brand ? `${product.brand} ` : ""}
          {product.name}
        </b>
        <div className="muted">
          {product.color || "Без цвета"} ·{" "}
          {product.article || product.model || "Без артикула"}
        </div>
        {stock.length ? (
          <div className="product-stock-preview">
            {stock.map((item: any) => (
              <span key={item.location_id}>
                <Icon icon={faWarehouse} />
                {item.name}: <b>{item.quantity}</b>
              </span>
            ))}
          </div>
        ) : (
          <div className="product-stock-preview muted">Нет остатков</div>
        )}
      </div>
      <strong>
        {product.total_stock ?? 0} <small>шт.</small>
      </strong>
    </button>
  );
}

function ProductDetail({
  product,
  onBack,
}: {
  product: Product;
  onBack: () => void;
}) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [currentProduct, setCurrentProduct] = useState(product);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<any>(product);
  const [editText, setEditText] = useState("");
  useEffect(() => {
    setCurrentProduct(product);
    setEditFields(product);
  }, [product]);
  const preview = async () => {
    try {
      const r = await post("/api/viber/preview", currentProduct);
      setMessage(r.message);
      setStatus("");
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  const publish = async () => {
    try {
      const r = await post("/api/viber/publish", { message });
      setStatus(
        r.published
          ? "Опубликовано через официальный Viber API."
          : "Автопубликация недоступна — используйте копирование.",
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  return (
    <section className="page">
      <button className="back" onClick={onBack}>
        ← Назад
      </button>
      <div className="hero-card">
        <p className="eyebrow">ТОВАР #{currentProduct.id}</p>
        <h2>
          {currentProduct.brand} {currentProduct.name}
        </h2>
        <p>
          {currentProduct.color} · {currentProduct.article || "Без артикула"}
        </p>
        <div className="chip-row">
          {currentProduct.sizes?.length ? (
            <span className="chip">
              Размеры {currentProduct.sizes.map((s) => s.size).join("–")}
            </span>
          ) : null}
          {currentProduct.pairsPerBox && (
            <span className="chip">{currentProduct.pairsPerBox} пар/короб</span>
          )}
          <span className="chip">{formatMoney(currentProduct.salePrice)}</span>
        </div>
      </div>
      <h3>Остаток по местам</h3>
      <div className="stock-list">
        {currentProduct.stock?.map((s: any) => (
          <div key={s.location_id}>
            <span>{s.name}</span>
            <b>{s.quantity}</b>
          </div>
        ))}
      </div>
      <h3>История движения</h3>
      <div className="history">
        {currentProduct.movements?.map((m: any) => (
          <div key={m.id}>
            <span className={m.quantity > 0 ? "positive" : ""}>
              {m.quantity > 0 ? "+" : ""}
              {m.quantity}
            </span>
            <span>
              {m.type.replaceAll("_", " ")}
              <small>{m.location_name}</small>
            </span>
            <time>{new Date(m.created_at).toLocaleString("uk-UA")}</time>
          </div>
        ))}
      </div>
      <div className="action-row">
        <button className="button" onClick={() => { setEditFields(currentProduct); setEditing(true); }}>
          <Icon icon={faPen} /> Редактировать
        </button>
        <button className="button danger" onClick={async () => {
          if (!window.confirm("Удалить этот товар? Действие нельзя отменить.")) return;
          try { await api(`/api/products/${currentProduct.id}`, { method: "DELETE" }); onBack(); }
          catch (error: any) { setStatus(error.message); }
        }}>
          <Icon icon={faTrash} /> Удалить товар
        </button>
        <a
          className="button"
          href={`/api/products/${currentProduct.id}/label`}
          target="_blank"
        >
          Этикетка
        </a>
        <button className="button" onClick={preview}>
          Предпросмотр Viber
        </button>
      </div>
      {!message && status && <div className="toast">{status}</div>}
      {message && (
        <div className="ocr-box">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="action-row">
            <button className="button primary" onClick={publish}>
              Опубликовать
            </button>
            <button
              className="button"
              onClick={() => navigator.clipboard?.writeText(message)}
            >
              Скопировать
            </button>
            <a
              className="button ghost"
              href={`viber://forward?text=${encodeURIComponent(message)}`}
              target="_blank"
            >
              Открыть Viber
            </a>
          </div>
          {status && <small className="muted">{status}</small>}
        </div>
      )}
      {editing && <ProductForm fields={editFields} setFields={setEditFields} text={editText} setText={setEditText} title="РЕДАКТИРОВАНИЕ ТОВАРА" onCancel={() => setEditing(false)} onSave={async () => {
        try { const result = await api<{ product: Product }>(`/api/products/${currentProduct.id}`, { method: "PATCH", body: JSON.stringify(editFields) }); setCurrentProduct(result.product); setEditFields(result.product); setStatus("Товар сохранён."); setEditing(false); }
        catch (error: any) { setStatus(error.message); }
      }} />}
    </section>
  );
}

function Receive({
  locations,
  onOpenProduct,
}: {
  locations: Location[];
  onOpenProduct: (p: Product) => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id || 0);
  const [directReceive, setDirectReceive] = useState(false);
  const [session, setSession] = useState<any>();
  const sessionRef = useRef<any>(undefined);
  const [last, setLast] = useState<any>();
  const [total, setTotal] = useState(0);
  const [received, setReceived] = useState<Record<number, number>>({});
  const [unknown, setUnknown] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [photoUploadingFor, setPhotoUploadingFor] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (
      !sessionRef.current &&
      locations.length &&
      !locations.some((location) => location.id === locationId)
    ) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  const scan = async (barcode: string) => {
    let createdSession = false;
    try {
      setToast("");
      let s = sessionRef.current;
      if (!s) {
        if (directReceive && !locationId)
          throw new Error("Выберите склад для прямой приёмки.");
        const created = await post("/api/receiving/sessions", directReceive ? { locationId } : {});
        s = created.session;
        createdSession = true;
        sessionRef.current = s;
        setSession(s);
      }
      const r = await post(`/api/receiving/sessions/${s.id}/scan`, { barcode }, { "Idempotency-Key": crypto.randomUUID() });
      setLast(r);
      setTotal((v) => v + 1);
      setReceived((current) => ({ ...current, [r.product.id]: (current[r.product.id] || 0) + 1 }));
      setToast(`+1 · ${r.product.brand} ${r.product.name}`);
    } catch (e: any) {
      if (e.code === "UNKNOWN_BARCODE") {
        if (createdSession && sessionRef.current) {
          try {
            await post(
              `/api/receiving/sessions/${sessionRef.current.id}/complete`,
              {},
            );
          } catch {
            // The empty session is harmless; do not hide the unknown-product flow.
          } finally {
            sessionRef.current = undefined;
            setSession(undefined);
          }
        }
        setUnknown(barcode);
        setToast("");
      } else
        setToast(e.message || "Операция не выполнена. Попробуйте ещё раз.");
    }
  };
  const uploadPhoto = async (file?: File) => {
    if (!file || !last?.product?.id) return;
    const productId = last.product.id;
    setPhotoUploadingFor(productId);
    setToast("");
    try {
      const form = new FormData();
      form.append("image", file, file.name || "product-photo.jpg");
      const response = await fetch(`/api/products/${productId}/photo`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Не удалось сохранить фото.");
      setLast((current: any) =>
        current?.product?.id === productId
          ? { ...current, product: result.product }
          : current,
      );
      setToast("Фото товара сохранено.");
    } catch (error: any) {
      setToast(error.message || "Не удалось сохранить фото.");
    } finally {
      setPhotoUploadingFor(null);
      if (photoInput.current) photoInput.current.value = "";
    }
  };
  return (
    <section className={`page receive-page ${session ? "receive-page--active" : ""}`}>
      <div className="page-head">
        <div>
          <p className="eyebrow">ПРИЁМКА</p>
          <h2>Сканируйте коробки</h2>
        </div>
        <span className="counter">{total}</span>
      </div>
      {!session && (directReceive ? (
          <label>
            Склад приёмки
            <select
              value={locationId}
              onChange={(e) => setLocationId(Number(e.target.value))}
            >
              {locations.filter((l) => l.receivingEnabled !== false && l.kind !== "UNASSIGNED").map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <button className="receive-direct-link" type="button" onClick={() => setDirectReceive(false)}>Принимать в «Нераспределено»</button>
          </label>
        ) : (
          <p className="muted">Принимаем в «Нераспределено». Склад выберете позже в распределении. <button className="receive-direct-link" type="button" onClick={() => setDirectReceive(true)}>Сразу на склад</button></p>
        ))}
      <Scanner
        variant="receive"
        onScan={scan}
        cameraOpen={cameraOpen}
        onCameraChange={setCameraOpen}
      />
      {toast && <div className="toast">{toast}</div>}
      {last && (
        <article className="receive-product-card">
          <input
            ref={photoInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => uploadPhoto(event.target.files?.[0])}
          />
          <div className="receive-product-top">
            <div className="receive-photo">
              {last.product.photoUrl ? (
                <img src={last.product.photoUrl} alt={last.product.name} />
              ) : (
                <button
                  className="receive-add-photo"
                  disabled={photoUploadingFor === last.product.id}
                  aria-label={photoUploadingFor === last.product.id ? "Сохраняем фото товара" : "Добавить фото товара"}
                  title={photoUploadingFor === last.product.id ? "Сохраняем фото" : "Добавить фото"}
                  onClick={() => photoInput.current?.click()}
                >
                  <Icon icon={faCamera} />
                  <span>{photoUploadingFor === last.product.id ? "Сохраняем…" : "Добавить фото"}</span>
                </button>
              )}
            </div>
            <div className="receive-product-summary">
              <div className="receive-scan-meta"><span><Icon icon={faCircleCheck} /> Последний скан</span><time>только что</time></div>
              <h3>{last.product.brand} {last.product.name}</h3>
              <p>{last.product.color} · {last.product.sizes?.map((size: any) => size.size).join("–") || "Размер не указан"}</p>
              <p>Артикул: {last.product.article || "—"}</p>
            </div>
          </div>
          <div className="receive-quantity-row">
            <span>Количество:</span>
            <div className="receive-stepper">
              <button aria-label="Убрать одну коробку" onClick={async () => {
              try {
                const result = await post(`/api/receiving/sessions/${sessionRef.current?.id}/remove-one`, { barcode: last.barcode || last.product.barcode }, { "Idempotency-Key": crypto.randomUUID() });
                setTotal((value) => Math.max(0, value - 1));
                setReceived((current) => ({ ...current, [last.product.id]: Math.max(0, (current[last.product.id] || 0) - 1) }));
                setToast(`−1 · ${result.product.brand} ${result.product.name}`);
              } catch (error: any) { setToast(error.message || "Не удалось убрать коробку."); }
              }}>−</button>
              <strong aria-live="polite">{received[last.product.id] || 0}</strong>
              <button aria-label="Добавить одну коробку" onClick={() => scan(last.barcode || last.product.barcode)}>+</button>
              <button className="receive-edit-quantity" aria-label="Ввести количество" onClick={() => setBulkOpen((value) => !value)}><Icon icon={faPen} /></button>
            </div>
          </div>
          {bulkOpen && <form className="receive-bulk-form" onSubmit={async (event) => {
              event.preventDefault();
                if (!bulk) return;
                try {
                  const r = await post(
                    `/api/receiving/sessions/${sessionRef.current?.id}/quantity`,
                    {
                      barcode: last.barcode || last.product.barcode,
                      quantity: Number(bulk),
                    },
                    { "Idempotency-Key": crypto.randomUUID() },
                  );
                  setLast(r);
                  setTotal((v) => v + r.quantity);
                  setReceived((current) => ({ ...current, [r.product.id]: (current[r.product.id] || 0) + r.quantity }));
                  setBulk("");
                  setBulkOpen(false);
                  setToast(`+${r.quantity} · ${r.product.brand} ${r.product.name}`);
                } catch (e: any) {
                  setToast(e.message || "Не удалось добавить количество.");
                }
            }}>
              <input autoFocus placeholder="Количество коробок" value={bulk} onChange={(e) => setBulk(e.target.value)} inputMode="numeric" />
              <button className="button primary" type="submit">Добавить</button>
            </form>}
          <div className="receive-card-actions">
            <button onClick={() => onOpenProduct(last.product)}><Icon icon={faPalette} /> Добавить цвет</button>
            <button onClick={() => onOpenProduct(last.product)}><Icon icon={faBoxOpen} /> Открыть товар <Icon icon={faChevronRight} /></button>
          </div>
        </article>
      )}
      {session && (
        <div className="action-row">
          <button
            className="button ghost"
            onClick={() => setCameraOpen((value) => !value)}
          >
            <Icon icon={cameraOpen ? faXmark : faCamera} />
            {cameraOpen ? "Остановить камеру" : "Открыть камеру"}
          </button>
          <button
            className="button primary"
            onClick={async () => {
              try {
                await post(
                  `/api/receiving/sessions/${sessionRef.current?.id}/complete`,
                  {},
                );
                sessionRef.current = undefined;
                setSession(undefined);
                setLast(undefined);
                setTotal(0);
                setReceived({});
                setToast("Приёмка завершена");
              } catch (e: any) {
                setToast(e.message || "Не удалось завершить приёмку.");
              }
            }}
          >
            Завершить
          </button>
        </div>
      )}
      {unknown && (
        <UnknownBarcode
          barcode={unknown}
          onDone={() => setUnknown("")}
          onReceive={() => scan(unknown)}
        />
      )}
    </section>
  );
}

function UnknownBarcode({
  barcode,
  onDone,
  onReceive,
}: {
  barcode: string;
  onDone: () => void;
  onReceive: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"choice" | "create" | "link">("choice");
  const [text, setText] = useState("");
  const [fields, setFields] = useState<any>({
    name: "",
    brand: "",
    article: "",
    color: "",
    sizes: [],
    pairsPerBox: "",
    salePrice: "",
    barcode,
  });
  const save = async () => {
    const r = await post("/api/products", fields);
    await onReceive();
    onDone();
  };
  if (mode === "choice")
    return (
      <div className="modal">
        <div className="modal-card">
          <p className="eyebrow">CODE NOT FOUND</p>
          <h3>Штрихкод {barcode}</h3>
          <p className="muted">Этот код ещё не связан с каталогом.</p>
          <button
            className="button primary wide"
            onClick={() => setMode("create")}
          >
            Создать товар
          </button>
          <button className="button ghost wide" onClick={() => setMode("link")}>
            Привязать к существующему
          </button>
          <button className="link" onClick={onDone}>
            Закрыть
          </button>
        </div>
      </div>
    );
  if (mode === "link")
    return (
      <div className="modal">
        <div className="modal-card">
          <h3>Привязать штрихкод</h3>
          <ProductSearch
            onSelect={async (p) => {
              await post(`/api/products/${p.id}/link-barcode`, { barcode });
              await onReceive();
              onDone();
            }}
          />
          <button className="link" onClick={onDone}>
            Отмена
          </button>
        </div>
      </div>
    );
  return (
    <ProductForm
      fields={fields}
      setFields={setFields}
      text={text}
      setText={setText}
      onSave={save}
      onCancel={onDone}
    />
  );
}

function ProductForm({
  fields,
  setFields,
  text,
  setText,
  onSave,
  onCancel,
  title = "НОВЫЙ ТОВАР",
}: {
  fields: any;
  setFields: (x: any) => void;
  text: string;
  setText: (x: string) => void;
  onSave: () => void;
  onCancel: () => void;
  title?: string;
}) {
  const [ocr, setOcr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const update = (key: string, value: any) =>
    setFields({ ...fields, [key]: value });
  return (
    <div className="modal">
      <div className="modal-card">
        <p className="eyebrow">{title}</p>
        <h3>Проверьте данные</h3>
        <div className="form-grid">
          <label>
            Название
            <input
              value={fields.name || ""}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label>
            Бренд
            <input
              value={fields.brand || ""}
              onChange={(e) => update("brand", e.target.value)}
            />
          </label>
          <label>
            Артикул
            <input
              value={fields.article || ""}
              onChange={(e) => update("article", e.target.value)}
            />
          </label>
          <label>
            Цвет
            <input
              value={fields.color || ""}
              onChange={(e) => update("color", e.target.value)}
            />
          </label>
          <label>
            Размеры
            <input
              value={(fields.sizes || []).map((s: any) => s.size).join("-")}
              onChange={(e) =>
                update(
                  "sizes",
                  e.target.value
                    .split("-")
                    .filter(Boolean)
                    .map((size: string) => ({ size, quantity: 1 })),
                )
              }
            />
          </label>
          <label>
            Пар в коробке
            <input
              type="number"
              value={fields.pairsPerBox || ""}
              onChange={(e) =>
                update(
                  "pairsPerBox",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </label>
          <label>
            Цена продажи
            <input
              type="number"
              step="0.01"
              value={fields.salePrice || ""}
              onChange={(e) =>
                update(
                  "salePrice",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </label>
          <label>
            Штрихкод
            <input
              value={fields.barcode || ""}
              onChange={(e) => update("barcode", e.target.value)}
            />
          </label>
        </div>
        <div className="ocr-box">
          <b>Помощь OCR</b>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setOcr("Распознаём…");
              const fd = new FormData();
              fd.append("image", f);
              const r = await fetch("/api/ocr/recognize", {
                method: "POST",
                body: fd,
                credentials: "include",
              });
              const j = await r.json();
              if (j.fields) {
                setFields({ ...fields, ...j.fields });
                setText(j.text || "");
              }
              setOcr(
                j.unavailable
                  ? "OCR недоступен — заполните форму вручную."
                  : "Поля предзаполнены, проверьте их перед сохранением.",
              );
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Или вставьте текст этикетки: ART: ...\nCOLOR: ..."
          />
          <button
            className="button"
            onClick={async () => {
              const r = await post("/api/ocr/parse", { text });
              setFields({ ...fields, ...r.fields });
              setOcr("Поля предзаполнены из текста. Проверьте их.");
            }}
          >
            Распознать текст
          </button>
          {ocr && <small className="muted">{ocr}</small>}
        </div>
        <div className="action-row">
          <button className="button ghost" onClick={onCancel}>
            Отмена
          </button>
          <button
            className="button primary"
            onClick={onSave}
            disabled={!fields.name}
          >
            Сохранить товар
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductSearch({ onSelect }: { onSelect: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  useEffect(() => {
    const id = setTimeout(
      () =>
        api<{ products: Product[] }>(
          `/api/products?query=${encodeURIComponent(q)}`,
        ).then((r) => setItems(r.products)),
      200,
    );
    return () => clearTimeout(id);
  }, [q]);
  return (
    <>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Название, артикул или штрихкод"
      />
      <div className="search-results">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} onSelect={onSelect} />
        ))}
      </div>
    </>
  );
}

function Stock({ onOpen }: { onOpen: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [only, setOnly] = useState(true);
  const [items, setItems] = useState<Product[]>([]);
  const brands = useBrands();
  useEffect(() => {
    const id = setTimeout(
      () =>
        api<{ products: Product[] }>(
          `/api/products?query=${encodeURIComponent(q)}&brand=${encodeURIComponent(brand)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}&inStock=${only}`,
        ).then((r) => setItems(r.products)),
      150,
    );
    return () => clearTimeout(id);
  }, [q, brand, color, size, only]);
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">КАТАЛОГ</p>
          <h2>Остатки</h2>
        </div>
      </div>
      <input
        className="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск: штрихкод, артикул, цвет…"
      />
      <div className="two-col">
        <label>
          Бренд
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Все бренды</option>
            {brands.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Цвет
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="Например, Black"
          />
        </label>
      </div>
      <label>
        Размер
        <input
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="Например, 40"
          inputMode="decimal"
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={only}
          onChange={(e) => setOnly(e.target.checked)}
        />{" "}
        Только в наличии
      </label>
      <div className="product-list">
        {items.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onSelect={async () => {
              const r = await api<{ product: Product }>(
                `/api/products/${p.id}`,
              );
              onOpen(r.product);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function Transfer({ locations }: { locations: Location[] }) {
  const [from, setFrom] = useState(locations[0]?.id || 0);
  const [to, setTo] = useState(locations[1]?.id || 0);
  const [lines, setLines] = useState<any[]>([]);
  const [done, setDone] = useState("");
  const scan = async (barcode: string) => {
    try {
      const r = await post("/api/scan", { barcode });
      const old = lines.find((x) => x.product.id === r.product.id);
      setLines(
        old
          ? lines.map((x) =>
              x.product.id === r.product.id
                ? { ...x, quantity: x.quantity + 1 }
                : x,
            )
          : [...lines, { product: r.product, quantity: 1 }],
      );
    } catch (e: any) {
      setDone(e.message);
    }
  };
  return (
    <section className="page">
      <p className="eyebrow">ПЕРЕМЕЩЕНИЕ</p>
      <h2>Перенести товар</h2>
      <div className="two-col">
        <label>
          Из
          <select
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          В
          <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Scanner onScan={scan} />
      {done && <div className="toast">{done}</div>}
      <div className="draft-list">
        {lines.map((l) => (
          <div key={l.product.id}>
            <span>
              {l.product.brand} {l.product.name}
            </span>
            <b>x{l.quantity}</b>
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <button
          className="button primary wide"
          onClick={async () => {
            try {
              await post("/api/transfers", {
                fromLocationId: from,
                toLocationId: to,
                lines: lines.map((l) => ({
                  productId: l.product.id,
                  quantity: l.quantity,
                })),
              });
              setLines([]);
              setDone("Перемещение подтверждено");
            } catch (e: any) {
              setDone(e.message);
            }
          }}
        >
          Подтвердить перемещение
        </button>
      )}
    </section>
  );
}

function Distribution({ locations }: { locations: Location[] }) {
  const destinations = locations.filter((location) => location.kind !== "UNASSIGNED");
  const [to, setTo] = useState(destinations[0]?.id || 0);
  const [lines, setLines] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const scan = async (barcode: string) => {
    try {
      const result = await post("/api/scan", { barcode });
      setLines((current) => {
        const found = current.find((line) => line.product.id === result.product.id);
        return found
          ? current.map((line) => line.product.id === result.product.id ? { ...line, quantity: line.quantity + 1 } : line)
          : [...current, { product: result.product, quantity: 1 }];
      });
      setStatus(`+1 · ${result.product.brand} ${result.product.name}`);
    } catch (error: any) { setStatus(error.message); }
  };
  return <section className="page">
    <div className="page-head"><div><p className="eyebrow">РАСПРЕДЕЛЕНИЕ</p><h2>Из «Нераспределено»</h2></div><span className="counter">{lines.reduce((sum, line) => sum + line.quantity, 0)}</span></div>
    <label>Куда распределяем<select value={to} onChange={(event) => setTo(Number(event.target.value))}>{destinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
    <p className="muted">Выберите склад один раз, затем сканируйте коробки.</p>
    <Scanner onScan={scan} />
    {status && <div className="toast">{status}</div>}
    <div className="draft-list">{lines.map((line) => <div key={line.product.id}><span>{line.product.brand} {line.product.name}</span><b>×{line.quantity}</b></div>)}</div>
    {!!lines.length && <button className="button primary wide" onClick={async () => {
      try {
        await post("/api/distributions", { toLocationId: to, lines: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })) }, { "Idempotency-Key": crypto.randomUUID() });
        setLines([]); setStatus("Распределение подтверждено");
      } catch (error: any) { setStatus(error.message); }
    }}>Распределить коробки</button>}
  </section>;
}

function Order({
  locations,
  onOpen,
}: {
  locations: Location[];
  onOpen: (p: Product) => void;
}) {
  const [step, setStep] = useState<"customer" | "scan" | "done">("customer");
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [matches, setMatches] = useState<any[]>([]);
  const [locationId, setLocationId] = useState(locations[0]?.id || 0);
  const [order, setOrder] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (customer.phone.length < 5) {
      setMatches([]);
      return;
    }
    const id = setTimeout(
      () =>
        api<{ customers: any[] }>(
          `/api/customers?query=${encodeURIComponent(customer.phone)}`,
        ).then((r) => setMatches(r.customers)),
      200,
    );
    return () => clearTimeout(id);
  }, [customer.phone]);
  const scan = async (barcode: string) => {
    try {
      const r = await post(`/api/orders/${order.id}/scan`, { barcode });
      setOrder(r.order);
    } catch (e: any) {
      setError(e.message);
    }
  };
  if (step === "customer")
    return (
      <section className="page">
        <p className="eyebrow">НОВЫЙ ЗАКАЗ</p>
        <h2>Клиент и склад</h2>
        <label>
          Имя клиента
          <input
            value={customer.name}
            onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
            placeholder="Например, Александр"
          />
        </label>
        <label>
          Телефон
          <input
            value={customer.phone}
            onChange={(e) =>
              setCustomer({ ...customer, phone: e.target.value })
            }
            placeholder="+380…"
          />
        </label>
        {matches.map((c) => (
          <button
            className="product-card"
            key={c.id}
            onClick={() => {
              setCustomer({ name: c.name, phone: c.phone });
              setMatches([]);
            }}
          >
            <span>
              <b>{c.name}</b>
              <small>
                {c.phone} · заказов {c.order_count}
              </small>
            </span>
            <span>Выбрать</span>
          </button>
        ))}
        <label>
          Откуда отгружаем
          <select
            value={locationId}
            onChange={(e) => setLocationId(Number(e.target.value))}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary wide"
          disabled={!customer.name || !customer.phone}
          onClick={async () => {
            try {
              const r = await post("/api/orders", {
                ...customer,
                sourceLocationId: locationId,
              });
              setOrder(r.order);
              setStep("scan");
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          Начать сканирование
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  if (step === "done")
    return (
      <section className="page">
        <div className="success-icon">✓</div>
        <h2>Продажа подтверждена</h2>
        <p className="muted">Накладная {order.delivery_number}</p>
        <div className="action-row">
          <a
            className="button primary"
            href={`/api/orders/${order.id}/delivery-note.pdf`}
            target="_blank"
          >
            Открыть PDF
          </a>
          <button
            className="button"
            onClick={() =>
              navigator.share?.({
                title: "Накладная",
                url: `${location.origin}/api/orders/${order.id}/delivery-note.pdf`,
              })
            }
          >
            Поделиться
          </button>
        </div>
      </section>
    );
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">ЗАКАЗ DRAFT</p>
          <h2>{customer.name}</h2>
          <p>{customer.phone}</p>
        </div>
        <span className="counter">
          {order.lines?.reduce((a, l) => a + l.quantity, 0) || 0}
        </span>
      </div>
      <Scanner onScan={scan} />
      {error && <div className="toast">{error}</div>}
      <div className="draft-list">
        {order.lines?.map((l: any) => (
          <div key={l.id}>
            <span>
              <b>
                {l.brand} {l.name}
              </b>
              <small>
                {l.color} · {l.article}
              </small>
            </span>
            <b>x{l.quantity}</b>
          </div>
        ))}
      </div>
      <button
        className="button primary wide"
        disabled={!order.lines?.length}
        onClick={async () => {
          try {
            const r = await post(
              `/api/orders/${order.id}/confirm`,
              {},
              { "Idempotency-Key": `confirm-${order.id}` },
            );
            setOrder(r.order);
            setStep("done");
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        Подтвердить продажу
      </button>
      <button
        className="link"
        onClick={async () => {
          await post(`/api/orders/${order.id}/cancel`, {});
          setStep("customer");
        }}
      >
        Отменить заказ
      </button>
    </section>
  );
}

function Count({ locations }: { locations: Location[] }) {
  const [locationId, setLocationId] = useState(locations[0]?.id || 0);
  const [count, setCount] = useState<any>();
  const [message, setMessage] = useState("");
  return (
    <section className="page">
      <p className="eyebrow">ИНВЕНТАРИЗАЦИЯ</p>
      <h2>Сверка остатков</h2>
      {!count ? (
        <>
          <label>
            Место
            <select
              value={locationId}
              onChange={(e) => setLocationId(Number(e.target.value))}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary wide"
            onClick={async () =>
              setCount((await post("/api/counts", { locationId })).count)
            }
          >
            Начать сверку
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            {count.location_name} · Сканирование не меняет склад
          </p>
          <div className="count-list">
            {count.lines.map((l: any) => (
              <div key={l.product_id}>
                <span>
                  {l.brand} {l.name}
                  <small>Ожидается {l.expected}</small>
                </span>
                <input
                  type="number"
                  min="0"
                  value={l.actual}
                  onChange={async (e) =>
                    setCount(
                      (
                        await post(`/api/counts/${count.id}/lines`, {
                          productId: l.product_id,
                          actual: Number(e.target.value),
                        })
                      ).count,
                    )
                  }
                />
              </div>
            ))}
          </div>
          <button
            className="button primary wide"
            onClick={async () => {
              setCount((await post(`/api/counts/${count.id}/apply`, {})).count);
              setMessage("Корректировки применены");
            }}
          >
            Проверить и применить
          </button>
          {message && <div className="toast">{message}</div>}
        </>
      )}
    </section>
  );
}

function WarehouseSettings({
  locations,
  onChanged,
}: {
  locations: Location[];
  onChanged: () => Promise<void>;
}) {
  const empty = { name: "", description: "" };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const reset = () => {
    setEditing(null);
    setForm(empty);
  };
  const save = async () => {
    try {
      setError("");
      if (editing)
        await api(`/api/locations/${editing}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
      else await post("/api/locations", form);
      await onChanged();
      setMessage(editing ? "Склад обновлён." : "Склад добавлен.");
      reset();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const remove = async (location: Location) => {
    if (
      !window.confirm(
        `Удалить склад «${location.name}»? Удаление возможно только при нулевых остатках.`,
      )
    )
      return;
    try {
      setError("");
      await api(`/api/locations/${location.id}`, { method: "DELETE" });
      await onChanged();
      setMessage("Склад удалён.");
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">НАСТРОЙКИ</p>
          <h2>Склады</h2>
        </div>
        <span className="settings-icon">
          <Icon icon={faWarehouse} />
        </span>
      </div>
      <p className="muted">
        Добавляйте любое количество мест хранения. Склад с остатками удалить
        нельзя.
      </p>
      <div className="warehouse-form">
        <label>
          Название склада
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Например, Шоурум"
          />
        </label>
        <label>
          Описание
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Необязательно"
          />
        </label>
        <div className="action-row">
          <button
            className="button primary"
            disabled={!form.name.trim()}
            onClick={save}
          >
            <Icon icon={editing ? faPen : faPlus} />{" "}
            {editing ? "Сохранить" : "Добавить склад"}
          </button>
          {editing && (
            <button className="button ghost" onClick={reset}>
              <Icon icon={faXmark} /> Отмена
            </button>
          )}
        </div>
      </div>
      {message && (
        <div className="toast success">
          <Icon icon={faCircleCheck} /> {message}
        </div>
      )}
      {error && <div className="toast error-toast">{error}</div>}
      <div className="warehouse-list">
        {locations.map((location) => (
          <div className="warehouse-row" key={location.id}>
            <span>
              <b>
                <Icon icon={faWarehouse} /> {location.name}
              </b>
              {location.description && <small>{location.description}</small>}
            </span>
            <span className="warehouse-actions">
              <button
                className="icon-button"
                aria-label={`Изменить ${location.name}`}
                onClick={() => {
                  setEditing(location.id);
                  setForm({
                    name: location.name,
                    description: location.description || "",
                  });
                  setMessage("");
                }}
              >
                <Icon icon={faPen} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`Удалить ${location.name}`}
                onClick={() => remove(location)}
              >
                <Icon icon={faTrash} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [page, setPage] = useState("home");
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<Product>();
  useEffect(() => {
    api("/api/me")
      .then(() => setLogged(true))
      .catch(() => setLogged(false));
  }, []);
  const loadLocations = async () => {
    const r = await api<{ locations: Location[] }>("/api/locations");
    setLocations(r.locations);
  };
  useEffect(() => {
    if (logged) loadLocations();
  }, [logged]);
  if (logged === null) return <div className="loading">Загрузка…</div>;
  if (!logged) return <Login onLogin={() => setLogged(true)} />;
  const open = async (p: Product) => {
    const r = await api<{ product: Product }>(`/api/products/${p.id}`);
    setSelected(r.product);
    setPage("detail");
  };
  return (
    <div className="app-shell">
      <header>
        <div className="brand">
          <span className="brand-mark small">OB</span>
          <b>OpenBoots</b>
        </div>
        <button
          className="logout"
          onClick={async () => {
            await post("/api/auth/logout", {});
            setLogged(false);
          }}
        >
          <Icon icon={faRightFromBracket} /> Выйти
        </button>
      </header>
      <main>
        {page === "home" && <Home setPage={setPage} />}{" "}
        {page === "receive" && (
          <Receive locations={locations} onOpenProduct={open} />
        )}{" "}
        {page === "stock" && <Stock onOpen={open} />}{" "}
        {page === "transfer" && <Transfer locations={locations} />}{" "}
        {page === "distribution" && <Distribution locations={locations} />}{" "}
        {page === "order" && <Order locations={locations} onOpen={open} />}{" "}
        {page === "count" && <Count locations={locations} />}{" "}
        {page === "settings" && (
          <WarehouseSettings locations={locations} onChanged={loadLocations} />
        )}{" "}
        {page === "detail" && selected && (
          <ProductDetail product={selected} onBack={() => setPage("stock")} />
        )}
      </main>
      {page !== "detail" && (
        <nav className="bottom-nav">
          <button
            className={page === "home" ? "active" : ""}
            onClick={() => setPage("home")}
          >
            <Icon icon={faBoxesPacking} />
            <small>Главная</small>
          </button>
          <button
            className={page === "stock" ? "active" : ""}
            onClick={() => setPage("stock")}
          >
            <Icon icon={faList} />
            <small>Остатки</small>
          </button>
          <button className="scan-nav" onClick={() => setPage("receive")}>
            <Icon icon={faBarcode} />
            <small>Скан</small>
          </button>
          <button
            className={page === "order" ? "active" : ""}
            onClick={() => setPage("order")}
          >
            <Icon icon={faCartPlus} />
            <small>Заказы</small>
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => setPage("settings")}
          >
            <Icon icon={faGear} />
            <small>Настройки</small>
          </button>
        </nav>
      )}
    </div>
  );
}
function Home({ setPage }: { setPage: (p: string) => void }) {
  return (
    <section className="page home">
      <div className="home-intro">
        <p className="eyebrow">МОБИЛЬНЫЙ СКЛАД</p>
        <h1>
          Покажите товар.
          <br />
          <em>Получите результат.</em>
        </h1>
        <p className="muted">
          Сканирование — самый быстрый путь к любой операции.
        </p>
      </div>
      <button className="scan-hero" onClick={() => setPage("receive")}>
        <span>
          <Icon icon={faBarcode} />
        </span>
        <b>СКАНИРОВАТЬ</b>
        <small>Камера или Bluetooth-сканер</small>
      </button>
      <div className="quick-grid">
        <button onClick={() => setPage("receive")}>
          <span>
            <Icon icon={faArrowDown} />
          </span>
          <b>Приёмка</b>
          <small>На склад</small>
        </button>
        <button onClick={() => setPage("order")}>
          <span>
            <Icon icon={faCartPlus} />
          </span>
          <b>Новый заказ</b>
          <small>Продажа</small>
        </button>
        <button onClick={() => setPage("stock")}>
          <span>
            <Icon icon={faBoxesPacking} />
          </span>
          <b>Остатки</b>
          <small>По местам</small>
        </button>
        <button onClick={() => setPage("transfer")}>
          <span>
            <Icon icon={faArrowRightArrowLeft} />
          </span>
          <b>Перенос</b>
          <small>Между местами</small>
        </button>
        <button onClick={() => setPage("distribution")}>
          <span>
            <Icon icon={faArrowRightArrowLeft} />
          </span>
          <b>Распределение</b>
          <small>Из нераспределённого</small>
        </button>
        <button onClick={() => setPage("settings")}>
          <span>
            <Icon icon={faGear} />
          </span>
          <b>Склады</b>
          <small>Настроить места</small>
        </button>
      </div>
      <button className="count-link" onClick={() => setPage("count")}>
        <Icon icon={faClipboardList} /> Инвентаризация →
      </button>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
