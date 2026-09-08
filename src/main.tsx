import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowLeft,
  faArrowRightArrowLeft,
  faBarcode,
  faBoxOpen,
  faBoxesPacking,
  faCamera,
  faCartPlus,
  faCheck,
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
import { api, post, removeProductPhoto, uploadProductPhoto, validateProductImage } from "./api";
import "./styles.css";
import "./product-image.css";

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
  parentLocationId?: number | null;
  warehouseId?: number;
  warehouseName?: string;
  floorNumber?: number | null;
  floorName?: string | null;
  fullLocation?: string;
  shortLocation?: string;
  isFloor?: boolean;
  hasFloors?: boolean;
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
  archived?: boolean;
};
const Icon = ({ icon, className }: { icon: any; className?: string }) => (
  <FontAwesomeIcon icon={icon} className={className} />
);
const RECEIVING_SESSION_KEY = "openboots.receiving.session";
const RECEIVING_REVIEW_KEY = "openboots.receiving.review";
const APP_PAGE_KEY = "openboots.page";
const readStored = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeStored = (key: string, value: string | null) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Storage may be unavailable in private browsing. */ }
};
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
  autoArm,
  resetScanKey,
}: {
  onScan: (barcode: string) => void | Promise<void>;
  variant?: "default" | "receive";
  cameraOpen?: boolean;
  onCameraChange?: (open: boolean) => void;
  autoArm?: boolean;
  resetScanKey?: string | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const scanQueue = useRef(Promise.resolve());
  const [manual, setManual] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [scanArmed, setScanArmed] = useState(variant !== "receive");
  const scanArmedRef = useRef(variant !== "receive");
  const [internalCamera, setInternalCamera] = useState(false);
  const camera = cameraOpen ?? internalCamera;
  const closeCamera = () => {
    onCameraChange?.(false);
    if (cameraOpen === undefined) setInternalCamera(false);
  };
  const [message, setMessage] = useState("Готов к сканированию");
  const last = useRef("");
  useEffect(() => { scanArmedRef.current = scanArmed; }, [scanArmed]);
  useEffect(() => {
    if (variant !== "receive" || !camera || !autoArm) return;
    last.current = "";
    setScanArmed(true);
    setMessage("Наведите код в рамку");
  }, [autoArm, camera, variant]);
  useEffect(() => {
    if (variant === "receive" && resetScanKey) last.current = "";
  }, [resetScanKey, variant]);
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
      if (variant === "receive" && !scanArmedRef.current) return;
      if (!code) {
        missedFrames += 1;
        if (missedFrames >= 4) last.current = "";
        return;
      }
      missedFrames = 0;
      if (code === last.current) return;
      last.current = code;
      if (variant === "receive") setScanArmed(false);
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
        const value = manual.trim();
        if (!value) return;
        onScan(value);
        setManual("");
        if (variant === "receive") setManualOpen(false);
      }}
    >
      <input
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        placeholder="Введите штрихкод"
        inputMode="numeric"
      />
      <button className="button primary" type="submit" aria-label="Подтвердить ручной ввод"><Icon icon={faCheck} /></button>
      {variant === "receive" && <button className="button ghost" type="button" aria-label="Отменить ручной ввод" onClick={() => { setManual(""); setManualOpen(false); }}><Icon icon={faXmark} /></button>}
    </form>
  );
  const toggleCamera = () => {
    const next = !camera;
    onCameraChange?.(next);
    if (cameraOpen === undefined) setInternalCamera(next);
  };
  const controls = variant === "receive" ? (
    <div className="scanner-receive-controls">
      {manualOpen ? (
        <div className="scanner-receive-row scanner-receive-row--manual">
          {manualForm}
        </div>
      ) : (
        <div className="scanner-receive-row">
          <button className="button ghost scanner-action manual-entry-link" onClick={() => setManualOpen(true)}>
            <Icon icon={faPen} />
            Ввести вручную
          </button>
          <button
            className={`button dark scanner-action scanner-scan-button ${camera && scanArmed ? "armed" : ""}`}
            onClick={camera ? () => { last.current = ""; setScanArmed(true); setMessage("Наведите код в рамку"); } : toggleCamera}
          >
            <Icon icon={camera ? faBarcode : faCamera} />
            {camera ? (scanArmed ? "Ищем код…" : "Сканировать") : "Включить камеру"}
          </button>
        </div>
      )}
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
      <span className="product-card-photo"><ProductThumbnail product={product} /></span>
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
                {item.fullLocation || item.name}: <b>{item.quantity}</b>
                {item.shortLocation && item.shortLocation !== item.fullLocation && <small className="location-short">{item.shortLocation}</small>}
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

function ProductPhoto({
  product,
  onCapture,
  onRemove,
  uploading = false,
  className = "",
}: {
  product: Product;
  onCapture: (file?: File) => void;
  onRemove?: () => void;
  uploading?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [imageState, setImageState] = useState<"missing" | "loading" | "ready" | "unavailable">(product.photoUrl ? "loading" : "missing");
  const [imageSource, setImageSource] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (!product.photoUrl) {
      setImageSource("");
      setImageState("missing");
      return undefined;
    }
    setImageState("loading");
    fetch(product.photoUrl, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (active) setImageState(response.status === 404 ? "missing" : "unavailable");
          return;
        }
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) {
          setImageSource(objectUrl);
          setImageState("ready");
        } else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active) setImageState("unavailable"); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [product.id, product.photoUrl, retryKey]);

  return (
    <div className={`product-photo ${className}`.trim()}>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={(event) => {
          onCapture(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="product-photo-media">
        {imageState === "ready" ? (
          <img src={imageSource} alt={product.name} />
        ) : imageState === "unavailable" ? (
          <div className="product-photo-error">
            <Icon icon={faBoxOpen} />
            <span>Не удалось загрузить фото</span>
            <button type="button" onClick={() => setRetryKey((key) => key + 1)}>Повторить</button>
          </div>
        ) : imageState === "loading" ? (
          <span className="product-photo-loading">Загрузка…</span>
        ) : (
          <button
            type="button"
            className="product-photo-add"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            <Icon icon={faCamera} />
            <span>{uploading ? "Сохраняем…" : "Добавить фото"}</span>
          </button>
        )}
      </div>
      {imageState === "ready" && <div className="product-photo-actions">
        <button type="button" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? "Сохраняем…" : "Заменить"}
        </button>
        {onRemove && <button type="button" className="danger" disabled={uploading} onClick={onRemove}>Удалить</button>}
      </div>}
    </div>
  );
}

function ProductThumbnail({ product, className = "" }: { product: Product; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.id, product.photoUrl]);
  return product.photoUrl && !failed
    ? <img className={className} src={product.photoUrl} alt="" onError={() => setFailed(true)} />
    : <Icon icon={faBoxOpen} />;
}

function AddColorForm({
  parent,
  onSave,
  onCancel,
}: {
  parent: Product;
  onSave: (input: { article: string; color: string; barcode: string; photo: File; idempotencyKey: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [article, setArticle] = useState("");
  const [color, setColor] = useState("");
  const [barcode, setBarcode] = useState("");
  const [photo, setPhoto] = useState<File>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const photoPreview = useMemo(() => photo ? URL.createObjectURL(photo) : "", [photo]);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  return (
    <div className="modal">
      <div className="modal-card add-color-modal">
        <p className="eyebrow">НОВЫЙ ЦВЕТ</p>
        <h3>{parent.brand} {parent.name}</h3>
        <p className="muted">Наследуются размеры, комплектация и цена. Для нового цвета обязателен отдельный артикул, штрихкод и фото.</p>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (!photo || saving) return;
          setSaving(true); setError("");
          try { await onSave({ article: article.trim(), color: color.trim(), barcode: barcode.trim(), photo, idempotencyKey: idempotencyKey.current }); }
          catch (reason: any) { setError(reason.message || "Не удалось добавить цвет."); setSaving(false); }
        }}>
          <label>Артикул<input autoFocus required value={article} onChange={(event) => setArticle(event.target.value)} /></label>
          <label>Цвет<input required value={color} onChange={(event) => setColor(event.target.value)} /></label>
          <label>Новый штрихкод<input required minLength={4} value={barcode} onChange={(event) => setBarcode(event.target.value)} inputMode="numeric" /></label>
          <input ref={photoInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
            try { validateProductImage(event.target.files?.[0]); setPhoto(event.target.files?.[0]); setError(""); }
            catch (reason: any) { setError(reason.message || "Не удалось выбрать фото."); }
            event.target.value = "";
          }} />
          <button type="button" className="add-color-photo" onClick={() => photoInput.current?.click()} disabled={saving}>
            {photoPreview ? <img src={photoPreview} alt="Фото нового цвета" /> : <><Icon icon={faCamera} /><span>Сделать или выбрать фото</span></>}
          </button>
          <small className="muted">JPEG, PNG или WebP, до 8 МБ.</small>
          {error && <div className="toast error-toast">{error}</div>}
          <div className="action-row">
            <button type="button" className="button ghost" disabled={saving} onClick={onCancel}>Отмена</button>
            <button className="button primary" type="submit" disabled={!article.trim() || !color.trim() || barcode.trim().length < 4 || !photo || saving}>{saving ? "Сохраняем…" : "Добавить цвет"}</button>
          </div>
        </form>
      </div>
    </div>
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
  const [closing, setClosing] = useState(false);
  const [closeAction, setCloseAction] = useState<"archive" | "move" | "writeoff">("archive");
  const [closeLocationId, setCloseLocationId] = useState(0);
  const [closeReason, setCloseReason] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  useEffect(() => { api<{ locations: Location[] }>("/api/locations").then((r) => { setLocations(r.locations); setCloseLocationId(r.locations[0]?.id || 0); }); }, []);
  const stockTotal = currentProduct.stock?.reduce((sum: number, item: any) => sum + item.quantity, 0) || 0;
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
  const uploadPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoUploading(true);
    setStatus("");
    try {
      const result = await uploadProductPhoto<{ product: Product }>(currentProduct.id, file);
      setCurrentProduct(result.product);
      setEditFields((current: any) => ({
        ...current,
        photoUrl: result.product.photoUrl,
      }));
      setStatus("Фото товара сохранено.");
    } catch (error: any) {
      setStatus(error.message || "Не удалось сохранить фото.");
    } finally {
      setPhotoUploading(false);
    }
  };
  const deletePhoto = async () => {
    if (!window.confirm("Удалить фотографию товара?")) return;
    setPhotoUploading(true);
    setStatus("");
    try {
      const result = await removeProductPhoto<{ product: Product }>(currentProduct.id);
      setCurrentProduct(result.product);
      setEditFields((current: any) => ({ ...current, photoUrl: null }));
      setStatus("Фото товара удалено.");
    } catch (error: any) {
      setStatus(error.message || "Не удалось удалить фото.");
    } finally {
      setPhotoUploading(false);
    }
  };
  return (
    <section className="page">
      <button className="back" onClick={onBack}>
        ← Назад
      </button>
      <div className="hero-card">
        <div className="product-detail-hero">
          <ProductPhoto product={currentProduct} onCapture={uploadPhoto} onRemove={deletePhoto} uploading={photoUploading} />
          <div>
            <p className="eyebrow">ТОВАР #{currentProduct.id}</p>
            {currentProduct.archived && <p className="toast">Товар в архиве</p>}
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
        </div>
      </div>
      <div className="action-row product-detail-actions">
        {currentProduct.archived ? <button className="button primary" onClick={async () => { try { const result=await post(`/api/products/${currentProduct.id}/restore`, {}); setCurrentProduct(result.product); setStatus("Товар восстановлен."); } catch (error: any) { setStatus(error.message); } }}>Восстановить</button> : null}
        <button className="button" onClick={() => { setEditFields(currentProduct); setEditing(true); }}>
          <Icon icon={faPen} /> Редактировать
        </button>
        <button className="button danger" onClick={() => setClosing(true)}>
          <Icon icon={faTrash} /> Закрыть товар
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
      <h3>Остаток по местам</h3>
      <div className="stock-list">
        {currentProduct.stock?.map((s: any) => (
          <div key={s.location_id}>
            <span>
              <b>{s.fullLocation || s.name}</b>
              {s.shortLocation && s.shortLocation !== s.fullLocation && <small className="location-short">{s.shortLocation}</small>}
            </span>
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
      {editing && <ProductForm fields={editFields} setFields={setEditFields} text={editText} setText={setEditText} title="РЕДАКТИРОВАНИЕ ТОВАРА" photoProduct={currentProduct} onCapturePhoto={uploadPhoto} onRemovePhoto={deletePhoto} photoUploading={photoUploading} onCancel={() => setEditing(false)} onSave={async () => {
        try { const result = await api<{ product: Product }>(`/api/products/${currentProduct.id}`, { method: "PATCH", body: JSON.stringify(editFields) }); setCurrentProduct(result.product); setEditFields(result.product); setStatus("Товар сохранён."); setEditing(false); }
        catch (error: any) { setStatus(error.message); }
      }} />}
      {closing && <div className="modal"><div className="modal-card"><p className="eyebrow">ЗАКРЫТЬ ТОВАР</p><h3>{stockTotal ? `Остаток: ${stockTotal} коробок` : "Остаток отсутствует"}</h3>{stockTotal ? <><label><input type="radio" checked={closeAction === "move"} onChange={() => setCloseAction("move")} /> Переместить остаток</label><label><input type="radio" checked={closeAction === "writeoff"} onChange={() => setCloseAction("writeoff")} /> Списать остаток</label>{closeAction === "move" && <label>Куда<select value={closeLocationId} onChange={(e) => setCloseLocationId(Number(e.target.value))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}<label>Причина<textarea value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Например, возврат поставщику" /></label></> : <p className="muted">Товар будет скрыт из обычного каталога, но останется в архиве с полной историей.</p>}<div className="action-row"><button className="button ghost" onClick={() => setClosing(false)}>Отмена</button><button className="button primary" onClick={async () => { try { const result=await post(`/api/products/${currentProduct.id}/close`, { action: stockTotal ? closeAction : "archive", toLocationId: closeAction === "move" ? closeLocationId : undefined, reason: closeReason }); setCurrentProduct(result.product); setClosing(false); setStatus("Товар перемещён в архив."); } catch (error: any) { setStatus(error.message); } }}>Закрыть и архивировать</button></div></div></div>}
    </section>
  );
}

function Receive({
  locations,
  onOpenProduct, onFinished, onBack,
  onLocationsChanged,
}: {
  locations: Location[];
  onOpenProduct: (p: Product) => void;
  onFinished: (session: any, direct: boolean) => void;
  onBack: () => void;
  onLocationsChanged: () => Promise<void>;
}) {
  const receivingLocations = locations.filter((location) => location.receivingEnabled !== false && location.kind !== "UNASSIGNED" && (!location.hasFloors || location.isFloor));
  const [locationId, setLocationId] = useState(receivingLocations[0]?.id || 0);
  const [directReceive, setDirectReceive] = useState(false);
  const [session, setSession] = useState<any>();
  const sessionRef = useRef<any>(undefined);
  const [last, setLast] = useState<any>();
  const [active, setActive] = useState<any>();
  const [mode, setMode] = useState<"position" | "conveyor">(() => readStored("openboots.receiving.mode") === "conveyor" ? "conveyor" : "position");
  const [review, setReview] = useState(() => readStored(RECEIVING_REVIEW_KEY) === "1" && Boolean(readStored(RECEIVING_SESSION_KEY)));
  const [completed, setCompleted] = useState<any>();
  const [addColor, setAddColor] = useState(false);
  const [colorParent, setColorParent] = useState<Product>();
  const [variants, setVariants] = useState<any>();
  const [archivedScan, setArchivedScan] = useState<any>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const [received, setReceived] = useState<Record<number, number>>({});
  const [receivedProducts, setReceivedProducts] = useState<Record<number, Product>>({});
  const [receivedBarcodes, setReceivedBarcodes] = useState<Record<number, string>>({});
  const [unknown, setUnknown] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [photoUploadingFor, setPhotoUploadingFor] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [createWarehouseOpen, setCreateWarehouseOpen] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState({ name: "", description: "" });
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseError, setWarehouseError] = useState("");
  const [toast, setToast] = useState("");
  const restoredSession = useRef(false);

  useEffect(() => {
    writeStored("openboots.receiving.mode", mode);
  }, [mode]);

  useEffect(() => {
    if (restoredSession.current) return;
    restoredSession.current = true;
    const storedId = readStored(RECEIVING_SESSION_KEY);
    if (!storedId) return;
    api<{ session: any }>(`/api/receiving/sessions/${encodeURIComponent(storedId)}`)
      .then(({ session: restored }) => {
        if (!restored || restored.status !== "OPEN") {
          writeStored(RECEIVING_SESSION_KEY, null);
          writeStored(RECEIVING_REVIEW_KEY, null);
          return;
        }
        sessionRef.current = restored;
        setSession(restored);
        const nextReceived: Record<number, number> = {};
        const nextProducts: Record<number, Product> = {};
        const nextBarcodes: Record<number, string> = {};
        let restoredTotal = 0;
        restored.lines.forEach((line: any) => {
          const quantity = Number(line.quantity) || 0;
          const productId = Number(line.product.id);
          nextReceived[productId] = quantity;
          nextProducts[productId] = line.product;
          nextBarcodes[productId] = line.barcode;
          restoredTotal += quantity;
        });
        setReceived(nextReceived);
        setReceivedProducts(nextProducts);
        setReceivedBarcodes(nextBarcodes);
        setTotal(restoredTotal);
        if (mode === "position") {
          const latest = restored.lines[restored.lines.length - 1];
          if (latest) {
            setActive({ product: latest.product, barcode: latest.barcode, quantity: latest.quantity, stock: latest.product.stock });
            setLast({ product: latest.product, barcode: latest.barcode, quantity: latest.quantity, stock: latest.product.stock });
          }
        }
      })
      .catch(() => { writeStored(RECEIVING_SESSION_KEY, null); writeStored(RECEIVING_REVIEW_KEY, null); });
  }, [mode]);
  useEffect(() => {
    writeStored(RECEIVING_REVIEW_KEY, review ? "1" : null);
  }, [review]);

  useEffect(() => {
    if (
      !sessionRef.current &&
      receivingLocations.length &&
      !receivingLocations.some((location) => location.id === locationId)
    ) {
      setLocationId(receivingLocations[0].id);
    }
  }, [receivingLocations, locationId]);
  useEffect(() => {
    if (!receivingLocations.length && directReceive) setDirectReceive(false);
  }, [receivingLocations.length, directReceive]);

  const startPosition = async () => {
    if (sessionRef.current) return;
    try {
      if (directReceive && !locationId) throw new Error("Выберите склад для прямой приёмки.");
      const created = await post("/api/receiving/sessions", directReceive ? { locationId } : {});
      sessionRef.current = created.session; setSession(created.session); writeStored(RECEIVING_SESSION_KEY, String(created.session.id));
    } catch (e: any) { setToast(e.message); }
  };
  const scan = async (barcode: string, productId?: number) => {
    try {
      setToast("");
      let s = sessionRef.current;
      if (!s) {
        await startPosition(); s = sessionRef.current;
        if (!s) return;
      }
      if (mode === "position" && active && barcode !== active.barcode) {
        setToast("Это другой товар. Сначала завершите текущую позицию кнопкой «Следующая модель»."); return;
      }
      const r = await post(`/api/receiving/sessions/${s.id}/scan`, { barcode, productId: productId || (active?.barcode === barcode ? active.product.id : undefined) }, { "Idempotency-Key": crypto.randomUUID() });
      setLast(r); if (mode === "position") setActive(r);
      setTotal((v) => v + 1);
      setReceived((current) => ({ ...current, [r.product.id]: (current[r.product.id] || 0) + 1 }));
      setReceivedProducts((current) => ({ ...current, [r.product.id]: r.product }));
      setReceivedBarcodes((current) => ({ ...current, [r.product.id]: barcode }));
    } catch (e: any) {
      if (e.code === "PRODUCT_ARCHIVED") {
        setArchivedScan({ barcode, product: e.details?.product });
      } else if (e.code === "VARIANT_SELECTION_REQUIRED") {
        setVariants({ barcode, products: e.products || [] });
      } else if (e.code === "UNKNOWN_BARCODE") {
        setUnknown(barcode);
        setToast("");
      } else
        setToast(e.message || "Операция не выполнена. Попробуйте ещё раз.");
    }
  };
  const uploadPhoto = async (file?: File) => {
    const productId = active?.product?.id || last?.product?.id;
    if (!file || !productId) return;
    setPhotoUploadingFor(productId);
    setToast("");
    try {
      const result = await uploadProductPhoto<{ product: Product }>(productId, file);
      setLast((current: any) =>
        current?.product?.id === productId
          ? { ...current, product: result.product }
          : current,
      );
      setActive((current: any) =>
        current?.product?.id === productId
          ? { ...current, product: result.product }
          : current,
      );
      setReceivedProducts((current) => ({ ...current, [productId]: result.product }));
      setToast("Фото товара сохранено.");
    } catch (error: any) {
      setToast(error.message || "Не удалось сохранить фото.");
    } finally {
      setPhotoUploadingFor(null);
    }
  };
  const addColorToReceiving = async ({ article, color, barcode, photo, idempotencyKey }: { article: string; color: string; barcode: string; photo: File; idempotencyKey: string }) => {
    if (!colorParent || !sessionRef.current) throw new Error("Приёмка не открыта.");
    const form = new FormData();
    form.append("parentProductId", String(colorParent.id));
    form.append("article", article);
    form.append("color", color);
    form.append("barcode", barcode);
    form.append("image", photo, photo.name || "product-color.jpg");
    const response = await fetch(`/api/receiving/sessions/${sessionRef.current.id}/colors`, {
      method: "POST",
      body: form,
      credentials: "include",
      headers: { "Idempotency-Key": idempotencyKey },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Не удалось добавить цвет.");
    setActive(result); setLast(result);
    setTotal((value) => value + result.quantity);
    setReceived((current) => ({ ...current, [result.product.id]: (current[result.product.id] || 0) + result.quantity }));
    setReceivedProducts((current) => ({ ...current, [result.product.id]: result.product }));
    setReceivedBarcodes((current) => ({ ...current, [result.product.id]: result.barcode }));
    setAddColor(false); setColorParent(undefined);
  };
  const lines = Object.entries(received).filter(([, quantity]) => quantity > 0);
  const historyLines = Object.entries(received);
  const editQuantity = async () => {
    const value = Number(bulk); if (!active || !Number.isInteger(value) || value < 0) return;
    try { await post(`/api/receiving/sessions/${sessionRef.current.id}/set-quantity`, { barcode: active.barcode, productId: active.product.id, quantity: value });
      setReceived((current) => ({ ...current, [active.product.id]: value })); setTotal((v) => v + value - (received[active.product.id] || 0)); setBulkOpen(false); setBulk("");
    } catch (e: any) { setToast(e.message); }
  };
  const adjustSummaryQuantity = async (product: Product, barcode: string, quantity: number) => {
    if (quantity < 0) return;
    try {
      await post(`/api/receiving/sessions/${sessionRef.current.id}/set-quantity`, { barcode, productId: product.id, quantity });
      const previous = received[product.id] || 0;
      setReceived((current) => ({ ...current, [product.id]: quantity }));
      setTotal((current) => current + quantity - previous);
    } catch (error: any) { setToast(error.message || "Не удалось изменить количество."); }
  };
  const openReceivedLine = (productId: number) => {
    const product = receivedProducts[productId];
    const barcode = receivedBarcodes[productId];
    if (!product || !barcode) return;
    setActive({ product, barcode });
    setLast({ product, barcode });
    setBulkOpen(false);
    setBulk("");
    setToast("");
  };
  const setReceivingCamera = (open: boolean) => setCameraOpen(open);
  if (completed) return <section className="page receive-page"><div className="success-icon">✓</div><p className="eyebrow">ПРИЁМКА ЗАВЕРШЕНА</p><h2>Приёмка #{completed.id}</h2><p className="muted">{completed.total} коробок</p>{completed.direct ? <button className="button primary wide" onClick={() => onFinished(completed, true)}>Открыть остатки склада</button> : <><p>Что сделать дальше?</p><button className="button primary wide" onClick={() => onFinished(completed, false)}>Распределить сейчас</button><button className="button ghost wide" onClick={() => onFinished(completed, true)}>Распределить позже</button></>}</section>;
  if (review) return <section className="page receive-page"><p className="eyebrow">СВОДКА ПРИЁМКИ</p><h2>Приёмка #{session?.id}</h2><div className="receiving-summary-total receiving-summary-total--top"><b>{total} коробок · {lines.length} позиций</b><span>Назначение: {directReceive ? locations.find((l) => l.id === locationId)?.name : "Нераспределено"}</span></div><div className="receiving-summary">{lines.map(([id, quantity]) => { const product=receivedProducts[Number(id)]; const barcode=receivedBarcodes[Number(id)]; return <article key={id} className="receiving-summary-item"><div className="receiving-summary-photo">{product ? <ProductThumbnail product={product} /> : <Icon icon={faBoxOpen} />}</div><div className="receiving-summary-info">{product ? <><b>{product.brand} {product.name}</b><small>{product.color || "Цвет не указан"} · Артикул: {product.article || "—"}</small>{product.sizes?.length ? <small>Размеры: {product.sizes.map((size: any) => size.size).join("–")}</small> : null}</> : <b>Принятая позиция</b>}</div><div className="receiving-summary-stepper"><button disabled={!product || quantity <= 0} onClick={() => product && adjustSummaryQuantity(product, barcode, Number(quantity) - 1)}>−</button><strong>{quantity}<small>коробок</small></strong><button disabled={!product || !barcode} onClick={() => product && adjustSummaryQuantity(product, barcode, Number(quantity) + 1)}>+</button></div></article>; })}</div><div className="receiving-summary-actions"><button className="button ghost wide" onClick={() => setReview(false)}>Назад к сканированию</button><button className="button primary wide" onClick={async () => { await post(`/api/receiving/sessions/${session.id}/complete`, {}); setCompleted({ id: session.id, total, direct: directReceive }); }}>Завершить приёмку</button></div></section>;
  return (
    <section className={`page receive-page ${session ? "receive-page--active" : ""}`}>
      {total === 0 && <button className="button ghost receive-back" onClick={onBack}><Icon icon={faArrowLeft} />Вернуться</button>}
      <div className="page-head">
        <div>
          <p className="eyebrow">ПРИЁМКА</p>
          <h2>Сканируйте коробки</h2>
        </div>
        <span className="counter">{total}</span>
      </div>
      {!session && <div className="receive-settings"><div className="receive-current-settings"><span><small>Назначение</small>{directReceive && receivingLocations.some((location) => location.id === locationId) ? `Сразу на склад · ${receivingLocations.find((location) => location.id === locationId)?.fullLocation || receivingLocations.find((location) => location.id === locationId)?.name}` : "Нераспределено"}</span><span><small>Режим</small>{mode === "position" ? "По позиции" : "Конвейер"}</span><button aria-label="Настройки сканирования" onClick={() => setSettingsOpen((value) => !value)}><Icon icon={faGear} /></button></div>{settingsOpen && <div className="receive-settings-panel"><p className="eyebrow">НАЗНАЧЕНИЕ</p><div className="receive-options"><button className={!directReceive ? "selected" : ""} onClick={() => setDirectReceive(false)}><i />Нераспределено</button>{receivingLocations.length ? <button className={directReceive ? "selected" : ""} onClick={() => setDirectReceive(true)}><i />Сразу на склад</button> : <span className="receive-destination-add"><button disabled><i />Сразу на склад</button><button className="receive-add-location" aria-label="Добавить склад" title="Добавить склад" onClick={() => { setWarehouseForm({ name: "", description: "" }); setWarehouseError(""); setCreateWarehouseOpen(true); }}><Icon icon={faPlus} /></button></span>}</div>{!receivingLocations.length && <p className="receive-settings-hint">Сначала добавьте склад в настройках мест.</p>}<p className="eyebrow">РЕЖИМ СКАНИРОВАНИЯ</p><div className="receive-options"><button className={mode === "position" ? "selected" : ""} onClick={() => setMode("position")}><i />По позиции</button><button className={mode === "conveyor" ? "selected" : ""} onClick={() => setMode("conveyor")}><i />Конвейер</button></div></div>}</div>}
      {!session && settingsOpen && directReceive && receivingLocations.length ? (
          <label>
            Склад приёмки
            <select
              value={locationId}
              onChange={(e) => setLocationId(Number(e.target.value))}
            >
              {receivingLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.fullLocation || l.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted">Товар будет принят в «Нераспределено» до распределения.</p>
        )}
      <Scanner
        variant="receive"
        onScan={scan}
        cameraOpen={cameraOpen}
        onCameraChange={setReceivingCamera}
        autoArm={!active}
        resetScanKey={active?.product?.photoUrl}
      />
      {toast && <div className="toast">{toast}</div>}
      {active && (
        <article className="receive-product-card">
          <div className="receive-product-top">
            <ProductPhoto
              product={active.product}
              className="receive-photo"
              onCapture={uploadPhoto}
              uploading={photoUploadingFor === active.product.id}
            />
            <div className="receive-product-summary">
              <div className="receive-scan-meta"><span><Icon icon={faCircleCheck} /> Последний скан</span><time>только что</time></div>
              <h3>{active.product.brand} {active.product.name}</h3>
              <p>{active.product.color} · {active.product.sizes?.map((size: any) => size.size).join("–") || "Размер не указан"}</p>
              <p>Артикул: {active.product.article || "—"}</p>
            </div>
          </div>
          <div className="receive-quantity-row">
            <span>Количество:</span>
            <div className="receive-stepper">
              <button aria-label="Убрать одну коробку" onClick={async () => {
              try {
                await post(`/api/receiving/sessions/${sessionRef.current?.id}/remove-one`, { barcode: active.barcode, productId: active.product.id }, { "Idempotency-Key": crypto.randomUUID() });
                setTotal((value) => Math.max(0, value - 1));
                setReceived((current) => ({ ...current, [active.product.id]: Math.max(0, (current[active.product.id] || 0) - 1) }));
              } catch (error: any) { setToast(error.message || "Не удалось убрать коробку."); }
              }}>−</button>
              <strong aria-live="polite">{received[active.product.id] || 0}</strong>
              <button aria-label="Добавить одну коробку" onClick={() => scan(active.barcode)}>+</button>
              <button className="receive-edit-quantity" aria-label="Ввести количество" onClick={() => setBulkOpen((value) => !value)}><Icon icon={faPen} /></button>
            </div>
          </div>
          {bulkOpen && <form className="receive-bulk-form" onSubmit={async (event) => {
              event.preventDefault();
                if (!bulk) return;
                try {
                  await editQuantity();
                } catch (e: any) {
                  setToast(e.message || "Не удалось добавить количество.");
                }
            }}>
              <input autoFocus placeholder="Итого коробок в позиции" value={bulk} onChange={(e) => setBulk(e.target.value)} inputMode="numeric" />
              <button className="button primary" type="submit">Сохранить</button>
            </form>}
          <div className="receive-card-actions">
            <button onClick={() => { setColorParent(active.product); setAddColor(true); }}><Icon icon={faPalette} /> + Добавить цвет</button>
            <button onClick={() => { setActive(undefined); setBulkOpen(false); }}>Следующая модель</button>
          </div>
        </article>
      )}
      {session && (
        <div className="action-row receive-finish-action">
          <button
            className="button primary"
            disabled={!session || total === 0}
            onClick={() => setReview(true)}
          >
            <Icon icon={faCircleCheck} />
            Завершить приёмку
          </button>
        </div>
      )}
      {session && historyLines.length > 0 && (
        <section className="receive-history" aria-label="Отсканированные товары">
          <div className="receive-history-head">
            <div>
              <p className="eyebrow">ИСТОРИЯ СЕССИИ</p>
              <h3>Прошлые сканы</h3>
            </div>
            <span>{historyLines.length}</span>
          </div>
          <div className="receive-history-list">
            {historyLines.map(([id, quantity]) => {
              const product = receivedProducts[Number(id)];
              const barcode = receivedBarcodes[Number(id)];
              if (!product || !barcode) return null;
              const selected = active?.product?.id === product.id;
              return (
                <button
                  type="button"
                  key={id}
                  className={`receive-history-item${selected ? " selected" : ""}`}
                  onClick={() => openReceivedLine(product.id)}
                >
                  <span className="receive-history-photo">
                    <ProductThumbnail product={product} />
                  </span>
                  <span className="receive-history-info">
                    <b>{product.brand} {product.name}</b>
                    <small>{product.color || "Цвет не указан"} · {product.article || "Артикул не указан"}</small>
                  </span>
                  <strong>{quantity}<small>кор.</small></strong>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {unknown && (
        <UnknownBarcode
          barcode={unknown}
          onDone={() => setUnknown("")}
          onReceive={() => scan(unknown)}
        />
      )}
      {variants && <div className="modal"><div className="modal-card"><p className="eyebrow">ШТРИХКОД СООТВЕТСТВУЕТ НЕСКОЛЬКИМ ЦВЕТАМ</p><h3>Выберите вариант</h3>{variants.products.map((product: Product) => <button key={product.id} className="button wide" onClick={() => { const code = variants.barcode; setVariants(undefined); scan(code, product.id); }}>{product.brand} {product.name} / {product.color}</button>)}<button className="link" onClick={() => setVariants(undefined)}>Отмена</button></div></div>}
      {archivedScan?.product && <div className="modal"><div className="modal-card"><p className="eyebrow">ТОВАР В АРХИВЕ</p><h3>{archivedScan.product.brand} {archivedScan.product.name}</h3><p className="muted">{archivedScan.product.color} · {archivedScan.product.article}</p><p>Как продолжить?</p><button className="button primary wide" onClick={async () => { try { await post(`/api/products/${archivedScan.product.id}/restore`, {}); const code=archivedScan.barcode; setArchivedScan(undefined); scan(code, archivedScan.product.id); } catch (error: any) { setToast(error.message); } }}>Восстановить с остатком</button><button className="button wide" onClick={async () => { try { await post(`/api/products/${archivedScan.product.id}/restore`, { resetStock:true, reason:"Новая приёмка после архива" }); const code=archivedScan.barcode; setArchivedScan(undefined); scan(code, archivedScan.product.id); } catch (error: any) { setToast(error.message); } }}>Начать заново с нуля</button><button className="link" onClick={() => setArchivedScan(undefined)}>Отмена</button></div></div>}
      {addColor && colorParent && <AddColorForm parent={colorParent} onSave={addColorToReceiving} onCancel={() => { setAddColor(false); setColorParent(undefined); }} />}
      {createWarehouseOpen && <div className="modal"><div className="modal-card receive-create-warehouse"><p className="eyebrow">НОВЫЙ СКЛАД</p><h3>Добавить место хранения</h3><label>Название склада<input autoFocus value={warehouseForm.name} onChange={(event) => setWarehouseForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например, Шоурум" /></label><label>Описание<input value={warehouseForm.description} onChange={(event) => setWarehouseForm((current) => ({ ...current, description: event.target.value }))} placeholder="Необязательно" /></label>{warehouseError && <div className="toast error-toast">{warehouseError}</div>}<div className="action-row"><button className="button ghost" disabled={warehouseSaving} onClick={() => setCreateWarehouseOpen(false)}>Отмена</button><button className="button primary" disabled={warehouseSaving || !warehouseForm.name.trim()} onClick={async () => { try { setWarehouseSaving(true); setWarehouseError(""); const result = await post("/api/locations", { name: warehouseForm.name.trim(), description: warehouseForm.description.trim() }); await onLocationsChanged(); setLocationId(result.location.id); setDirectReceive(true); setCreateWarehouseOpen(false); } catch (error: any) { setWarehouseError(error.message || "Не удалось добавить склад."); } finally { setWarehouseSaving(false); } }}>Добавить склад</button></div></div></div>}
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
  const [createdProduct, setCreatedProduct] = useState<Product>();
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
  const save = async (photo?: File) => {
    const product = createdProduct || (await post<{ product: Product }>("/api/products", fields)).product;
    if (!createdProduct) setCreatedProduct(product);
    if (photo) await uploadProductPhoto(product.id, photo);
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
  photoProduct,
  onCapturePhoto,
  onRemovePhoto,
  photoUploading,
}: {
  fields: any;
  setFields: (x: any) => void;
  text: string;
  setText: (x: string) => void;
  onSave: (photo?: File) => Promise<void> | void;
  onCancel: () => void;
  title?: string;
  photoProduct?: Product;
  onCapturePhoto?: (file?: File) => void;
  onRemovePhoto?: () => void;
  photoUploading?: boolean;
}) {
  const [ocr, setOcr] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftPhoto, setDraftPhoto] = useState<File>();
  const file = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const draftPhotoPreview = useMemo(() => draftPhoto ? URL.createObjectURL(draftPhoto) : "", [draftPhoto]);
  useEffect(() => () => { if (draftPhotoPreview) URL.revokeObjectURL(draftPhotoPreview); }, [draftPhotoPreview]);
  const update = (key: string, value: any) =>
    setFields({ ...fields, [key]: value });
  return (
    <div className="modal">
      <div className="modal-card">
        <p className="eyebrow">{title}</p>
        <h3>Проверьте данные</h3>
        {photoProduct && onCapturePhoto && (
          <div className="product-form-photo">
            <span>Фото товара</span>
            <ProductPhoto
              product={photoProduct}
              onCapture={onCapturePhoto}
              onRemove={onRemovePhoto}
              uploading={photoUploading}
            />
          </div>
        )}
        {!photoProduct && <div className="product-form-photo product-form-photo--draft">
          <div>
            <span>Фото товара</span>
            <small>Необязательно · JPEG, PNG или WebP, до 8 МБ.</small>
          </div>
          <input ref={photoInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
            try { validateProductImage(event.target.files?.[0]); setDraftPhoto(event.target.files?.[0]); setSaveError(""); }
            catch (error: any) { setSaveError(error.message); }
            event.target.value = "";
          }} />
          {draftPhotoPreview ? <div className="product-draft-photo"><img src={draftPhotoPreview} alt="Выбранное фото товара" /><div><button type="button" onClick={() => photoInput.current?.click()}>Заменить</button><button type="button" className="danger" onClick={() => setDraftPhoto(undefined)}>Удалить</button></div></div> : <button type="button" className="product-draft-photo-add" onClick={() => photoInput.current?.click()}><Icon icon={faCamera} /> Сделать или выбрать фото</button>}
        </div>}
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
            onClick={async () => {
              setSaveError(""); setSaving(true);
              try { await onSave(draftPhoto); }
              catch (error: any) { setSaveError(error.message || "Не удалось сохранить товар."); }
              finally { setSaving(false); }
            }}
            disabled={!fields.name || saving || photoUploading}
          >
            {saving ? "Сохраняем…" : "Сохранить товар"}
          </button>
        </div>
        {saveError && <div className="toast error-toast">{saveError}</div>}
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
  const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const brands = useBrands();
  useEffect(() => {
    const id = setTimeout(
      () =>
        api<{ products: Product[] }>(
          `/api/products?query=${encodeURIComponent(q)}&brand=${encodeURIComponent(brand)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}&inStock=${only}&archived=${archived}`,
        ).then((r) => setItems(r.products)),
      150,
    );
    return () => clearTimeout(id);
  }, [q, brand, color, size, only, archived]);
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
      <label className="toggle"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Архив</label>
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

function Distribution({ locations, batch }: { locations: Location[]; batch?: any }) {
  const destinations = locations.filter((location) => location.kind !== "UNASSIGNED" && !location.isFloor);
  const [warehouseId, setWarehouseId] = useState(destinations[0]?.id || 0);
  const floors = locations.filter((location) => location.isFloor && location.warehouseId === warehouseId);
  const [floorId, setFloorId] = useState(floors[0]?.id || 0);
  const to = floorId || warehouseId;
  const [lines, setLines] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [selecting, setSelecting] = useState(Boolean(batch));
  const [selected, setSelected] = useState<number[]>([]);
  const [activeBatch, setActiveBatch] = useState<any>(batch);
  const [batches, setBatches] = useState<any[]>([]);
  useEffect(() => { api<any>("/api/receiving/batches").then((r) => { setBatches(r.batches); const selectedBatch = batch || r.batches[0]; setActiveBatch(selectedBatch); setLines(selectedBatch?.lines || []); setSelected((selectedBatch?.lines || []).map((line: any) => line.product.id)); }).catch((e) => setStatus(e.message)); }, [batch]);
  useEffect(() => { if (!destinations.some((location) => location.id === warehouseId)) setWarehouseId(destinations[0]?.id || 0); }, [locations, warehouseId]);
  useEffect(() => { setFloorId(floors[0]?.id || 0); }, [warehouseId, locations.length]);
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
    <div className="page-head"><div><p className="eyebrow">РАСПРЕДЕЛЕНИЕ</p><h2>{activeBatch ? `Приёмка #${activeBatch.id}` : "Из «Нераспределено»"}</h2>{activeBatch && <p>{activeBatch.total} коробок · выберите позиции для распределения</p>}</div><span className="counter">{lines.reduce((sum, line) => sum + line.quantity, 0)}</span></div>
    {batches.length > 1 && <label>Партия приёмки<select value={activeBatch?.id || ""} onChange={(event) => { const selectedBatch = batches.find((item) => item.id === Number(event.target.value)); setActiveBatch(selectedBatch); setLines(selectedBatch?.lines || []); setSelected((selectedBatch?.lines || []).map((line: any) => line.product.id)); }}>{batches.map((item) => <option key={item.id} value={item.id}>Приёмка #{item.id} · {item.total} коробок</option>)}</select></label>}
    <div className="distribution-destination"><label>Склад<select value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>{destinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>{floors.length ? <label>Этаж<select value={floorId} onChange={(event) => setFloorId(Number(event.target.value))}>{floors.map((location) => <option key={location.id} value={location.id}>{location.floorName || location.name}</option>)}</select></label> : <p className="muted distribution-floor-hint">У этого склада этажи ещё не настроены — товар будет перемещён в склад.</p>}</div>
    <p className="muted">Выберите позиции из «Нераспределено» — повторно сканировать коробки не нужно.</p>
    {status && <div className="toast">{status}</div>}
    <button className="button ghost wide" onClick={() => setSelecting((value) => !value)}>{selecting ? "Готово" : "Выбрать"}</button>
    <div className="draft-list">{lines.map((line) => <div key={line.product.id} onClick={() => selecting && setSelected((current) => current.includes(line.product.id) ? current.filter((id) => id !== line.product.id) : [...current, line.product.id])}><span>{selecting && <input type="checkbox" readOnly checked={selected.includes(line.product.id)} />} <b>{line.product.brand} {line.product.name}</b><small>{line.product.color} · {line.product.article}</small></span><b>×{line.quantity}</b></div>)}</div>
    {!!lines.length && <button className="button primary wide" disabled={selecting && !selected.length} onClick={async () => {
      try {
        const picked = selecting ? lines.filter((line) => selected.includes(line.product.id)) : lines;
        await post("/api/distributions", { batchId: activeBatch?.id, toLocationId: to, lines: picked.map((line) => ({ productId: line.product.id, quantity: line.quantity })) }, { "Idempotency-Key": crypto.randomUUID() });
        setLines((current) => current.filter((line) => !picked.some((item) => item.product.id === line.product.id))); setSelected([]); setStatus("Распределение подтверждено");
      } catch (error: any) { setStatus(error.message); }
    }}>Распределить выбранное</button>}
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
  const [floorFor, setFloorFor] = useState<number | null>(null);
  const [floorLabel, setFloorLabel] = useState("");
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
  const addFloor = async (location: Location) => {
    if (!floorLabel.trim()) return;
    try {
      setError("");
      await post(`/api/locations/${location.id}/floors`, { label: floorLabel.trim() });
      await onChanged();
      setFloorFor(null);
      setFloorLabel("");
      setMessage(`Этаж добавлен в «${location.name}».`);
    } catch (e: any) { setError(e.message); }
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
        Добавляйте склады и этажи. Остатки хранятся на конкретном этаже; склад
        с остатками удалить нельзя.
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
        {locations.filter((location) => !location.isFloor).map((location) => (
          <div className="warehouse-row" key={location.id}>
            <span>
              <b>
                <Icon icon={faWarehouse} /> {location.name}
              </b>
              {location.description && <small>{location.description}</small>}
              {!!location.hasFloors && <div className="warehouse-floors">{locations.filter((floor) => floor.parentLocationId === location.id).map((floor) => <span className="warehouse-floor-chip" key={floor.id}>{floor.floorName || floor.name}</span>)}</div>}
              {floorFor === location.id ? <div className="warehouse-floor-form"><input autoFocus value={floorLabel} onChange={(event) => setFloorLabel(event.target.value)} placeholder="Например, 2 этаж" /><button className="button primary" onClick={() => addFloor(location)}>Добавить</button><button className="button ghost" onClick={() => { setFloorFor(null); setFloorLabel(""); }}>Отмена</button></div> : <button className="link warehouse-add-floor" onClick={() => { setFloorFor(location.id); setFloorLabel(""); }}>+ Добавить этаж</button>}
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
  const [page, setPage] = useState(() => readStored(APP_PAGE_KEY) || "home");
  const [distributionBatch, setDistributionBatch] = useState<any>();
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
  useEffect(() => {
    if (page === "receive") writeStored(APP_PAGE_KEY, "receive");
    else writeStored(APP_PAGE_KEY, null);
  }, [page]);
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
          <Receive locations={locations} onOpenProduct={open} onLocationsChanged={loadLocations} onBack={() => setPage("home")} onFinished={(session, direct) => {
            if (direct) setPage("stock"); else { setDistributionBatch(session); setPage("distribution"); }
          }} />
        )}{" "}
        {page === "stock" && <Stock onOpen={open} />}{" "}
        {page === "transfer" && <Transfer locations={locations} />}{" "}
        {page === "distribution" && <Distribution locations={locations} batch={distributionBatch} />}{" "}
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
