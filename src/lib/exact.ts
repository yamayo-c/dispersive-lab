/**
 * 厳密解。いずれも実数直線上の解で、周期区間で使うときは
 * 解の裾が区間の端で倍精度の丸め誤差以下になるように区間を広く取る。
 *
 * 方程式の規約は  i u_t + α u_xx + κ |u|² u = 0（src/solvers/schrodinger.ts と同じ）。
 */

type Complex = readonly [number, number];

/** 複素数の積 */
function cmul(a: Complex, b: Complex): [number, number] {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

/** 複素数の商 */
function cdiv(a: Complex, b: Complex): [number, number] {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

/** 複素数の指数関数 */
function cexp(z: Complex): [number, number] {
  const r = Math.exp(z[0]);
  return [r * Math.cos(z[1]), r * Math.sin(z[1])];
}

/** 主枝の平方根 */
function csqrt(z: Complex): [number, number] {
  const r = Math.hypot(z[0], z[1]);
  const re = Math.sqrt((r + z[0]) / 2);
  const im = Math.sign(z[1] || 1) * Math.sqrt(Math.max(r - z[0], 0) / 2);
  return [re, im];
}

export interface GaussianPacket {
  /** 振幅 */
  amplitude: number;
  /** 初期幅 s（u₀ = A exp(−(x−x₀)²/(2s²)) e^{ik₀(x−x₀)}） */
  width: number;
  /** 初期中心 x₀ */
  center: number;
  /** 搬送波数 k₀ */
  wavenumber: number;
}

/**
 * 線形 Schrödinger 方程式 i u_t + α u_xx = 0 の Gauss 波束の厳密解。
 *
 *     u(x, t) = A (s² / (s² + 2iαt))^{1/2}
 *               · exp( −(x − x₀ − 2αk₀t)² / (2(s² + 2iαt)) )
 *               · exp( i k₀ (x − x₀) − i α k₀² t ).
 *
 * 中心は群速度 2αk₀ で進み、|u| の幅は s (1 + (2αt/s²)²)^{1/2} に広がる。
 * （k₀ = 0 の熱核型の解に Galilei 変換 u ↦ u(x − 2αk₀t, t) e^{ik₀x − iαk₀²t} を施したもの）
 */
export function linearGaussian(p: GaussianPacket, alpha: number, x: number, t: number): [number, number] {
  const s2 = p.width * p.width;
  const denom: Complex = [s2, 2 * alpha * t];
  const prefactor = csqrt(cdiv([s2, 0], denom));
  const y = x - p.center - 2 * alpha * p.wavenumber * t;
  const gauss = cexp(cdiv([-(y * y) / 2, 0], denom));
  const carrier = cexp([0, p.wavenumber * (x - p.center) - alpha * p.wavenumber * p.wavenumber * t]);
  const v = cmul(cmul(prefactor, gauss), carrier);
  return [p.amplitude * v[0], p.amplitude * v[1]];
}

/** 線形 Schrödinger の Gauss 波束の |u| の幅 s(t) = s (1 + (2αt/s²)²)^{1/2} */
export function linearGaussianWidth(width: number, alpha: number, t: number): number {
  const r = (2 * alpha * t) / (width * width);
  return width * Math.sqrt(1 + r * r);
}

export interface Soliton {
  /** 振幅 a（> 0） */
  amplitude: number;
  /** 速度 v */
  velocity: number;
  /** t = 0 での中心 x₀ */
  center: number;
  /** t = 0 での位相 θ₀ */
  phase: number;
}

/**
 * focusing NLS  i u_t + α u_xx + κ|u|²u = 0（α, κ > 0）の 1 ソリトン。
 *
 *     u(x, t) = a sech( b (x − x₀ − vt) ) exp( i ( v(x − x₀)/(2α) + ω t + θ₀ ) ),
 *     b = a (κ / (2α))^{1/2},   ω = κa²/2 − v²/(4α).
 *
 * （静止解 a sech(bx) e^{iκa²t/2} に Galilei 変換を施したもの）
 */
export function nlsSoliton(p: Soliton, alpha: number, kappa: number, x: number, t: number): [number, number] {
  if (!(alpha > 0 && kappa > 0)) throw new Error("1 ソリトンは α > 0, κ > 0（focusing）のときだけ存在する");
  const a = p.amplitude;
  const b = a * Math.sqrt(kappa / (2 * alpha));
  const omega = (kappa * a * a) / 2 - (p.velocity * p.velocity) / (4 * alpha);
  const y = x - p.center - p.velocity * t;
  const env = a / Math.cosh(b * y);
  const theta = (p.velocity * (x - p.center)) / (2 * alpha) + omega * t + p.phase;
  return [env * Math.cos(theta), env * Math.sin(theta)];
}

/**
 * 実数直線上の解 f(x, t) を周期 L で周期化する:  Σ_m f(x + mL, t)。
 *
 * 線形方程式なら、周期化したものは周期境界の問題の厳密解になる（各項が解で、和が収束する限り）。
 * 足す項は、|項| が tol を下回るまで m = 0, ±1, ±2, … と広げる（最大 maxImages 個ずつ）。
 * 非線形方程式の解には使えない（重ね合わせが成り立たないため）。
 */
export function periodize(
  f: (x: number, t: number) => readonly [number, number],
  length: number,
  x: number,
  t: number,
  tol = 1e-18,
  maxImages = 64,
): [number, number] {
  const [re0, im0] = f(x, t);
  let re = re0;
  let im = im0;
  for (const dir of [1, -1]) {
    for (let m = 1; m <= maxImages; m++) {
      const [a, b] = f(x + dir * m * length, t);
      re += a;
      im += b;
      if (Math.hypot(a, b) < tol) break;
    }
  }
  return [re, im];
}
