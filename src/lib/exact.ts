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

/**
 * KdV 方程式 u_t + 6uu_x + u_xxx = 0（src/solvers/kdv.ts と同じ規約）の 1 ソリトン
 *
 *     u(x, t) = (k²/2) sech²( (k/2)(x − x₀ − k²t) ).
 *
 * 速さ k²、高さ k²/2（高いほど速い）。
 */
export function kdvSoliton(k: number, x0: number, x: number, t: number): number {
  const s = 1 / Math.cosh((k / 2) * (x - x0 - k * k * t));
  return ((k * k) / 2) * s * s;
}

/**
 * KdV 方程式 u_t + 6uu_x + u_xxx = 0 の 2 ソリトン解（広田）
 *
 *     u = 2 (log τ)_xx,   τ = 1 + e^{η₁} + e^{η₂} + A₁₂ e^{η₁+η₂},
 *     η_i = k_i x − k_i³ t + η_i⁰,   A₁₂ = ((k₁ − k₂)/(k₁ + k₂))².
 *
 * τ の 4 つの項を w_m = e^{θ_m}（θ = 0, η₁, η₂, η₁+η₂+log A₁₂）、x 微分の係数を
 * κ_m = 0, k₁, k₂, k₁+k₂ と書くと  τ τ_xx − τ_x² = Σ_{m<l} w_m w_l (κ_m − κ_l)²  なので
 *
 *     u = 2 Σ_{m<l} w_m w_l (κ_m − κ_l)² / (Σ_m w_m)².
 *
 * 正の項の和だけで書けるので桁落ちがなく、w_m を最大の θ_m で割っておけば e^{η} が溢れることもない。
 */
export function kdvTwoSoliton(k1: number, k2: number, x: number, t: number, eta10 = 0, eta20 = 0): number {
  const a12 = ((k1 - k2) / (k1 + k2)) ** 2;
  const e1 = k1 * x - k1 ** 3 * t + eta10;
  const e2 = k2 * x - k2 ** 3 * t + eta20;
  const theta = [0, e1, e2, e1 + e2 + Math.log(a12)];
  const kappa = [0, k1, k2, k1 + k2];
  const m = Math.max(...theta);
  const w = theta.map((th) => Math.exp(th - m));
  let tau = 0;
  for (const wi of w) tau += wi;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) num += w[i]! * w[j]! * (kappa[i]! - kappa[j]!) ** 2;
  }
  return (2 * num) / (tau * tau);
}

/** 2 ソリトン解の 1 つ分のパラメータ（i u_t + u_xx + 2|u|²u = 0 の規約） */
export interface NlsSolitonParams {
  /** 振幅 a（> 0） */
  amplitude: number;
  /** 速度 v */
  velocity: number;
  /** もう一方のソリトンが遠くにあるときの、t = 0 での中心 x₀ */
  center: number;
  /** 位相 φ */
  phase: number;
}

/**
 * focusing NLS  i u_t + u_xx + 2|u|²u = 0（α = 1, κ = 2）の 2 ソリトン解（広田の形）。
 *
 *     k_j = a_j + i v_j/2,   θ_j = k_j x + i k_j² t + θ_j⁰,   θ_j⁰ = −k_j x_j + log(2a_j) + iφ_j,   E_j = e^{θ_j},
 *     u = g / f,
 *     f = 1 + Σ_{i,j} E_i Ē_j / (k_i + k̄_j)² + |k₁ − k₂|⁴ |E₁|²|E₂|² / ((k₁+k̄₁)² (k₂+k̄₂)² |k₁+k̄₂|⁴),
 *     g = E₁ + E₂ + (k₁ − k₂)² [ E₁E₂Ē₁ / ((k₁+k̄₁)²(k₂+k̄₁)²) + E₁E₂Ē₂ / ((k₁+k̄₂)²(k₂+k̄₂)²) ].
 *
 * E₂ = 0 とすると f = 1 + |E₁|²/(4a₁²)、u = a₁ sech(a₁(x − x₁ − v₁t)) e^{i(v₁(x − x₁)/2 + (a₁² − v₁²/4)t + φ₁)} で、
 * 1 ソリトン（nlsSoliton, α = 1, κ = 2）と一致する。
 * 各項の大きさは e^{2 Re θ} 程度まで増えるので、f と g を e^{2M}（M = max(0, Re θ₁, Re θ₂, Re θ₁ + Re θ₂)）で割って計算する。
 */
export function nlsTwoSoliton(s1: NlsSolitonParams, s2: NlsSolitonParams, x: number, t: number): [number, number] {
  const k1: Complex = [s1.amplitude, s1.velocity / 2];
  const k2: Complex = [s2.amplitude, s2.velocity / 2];
  const conj = (z: Complex): Complex => [z[0], -z[1]];
  const add = (a: Complex, b: Complex): [number, number] => [a[0] + b[0], a[1] + b[1]];
  const sub = (a: Complex, b: Complex): [number, number] => [a[0] - b[0], a[1] - b[1]];
  const sq = (z: Complex) => cmul(z, z);
  const abs2 = (z: Complex) => z[0] * z[0] + z[1] * z[1];
  // θ_j = k_j (x − x_j) + i k_j² t + log(2a_j) + iφ_j
  const theta = (k: Complex, s: NlsSolitonParams): [number, number] => {
    const ik2t = cmul([0, t], sq(k));
    return [k[0] * (x - s.center) + ik2t[0] + Math.log(2 * s.amplitude), k[1] * (x - s.center) + ik2t[1] + s.phase];
  };
  const th1 = theta(k1, s1);
  const th2 = theta(k2, s2);
  const m = Math.max(0, th1[0], th2[0], th1[0] + th2[0]);
  // e^{z − shift} を複素数で
  const ex = (z: Complex, shift: number) => cexp([z[0] - shift, z[1]]);
  // 各項を e^{2m} で割ったもの。E_i Ē_j = e^{θ_i + θ̄_j}
  const pair = (a: Complex, b: Complex) => ex(add(a, conj(b)), 2 * m);
  const k11 = add(k1, conj(k1)); // 2a₁
  const k22 = add(k2, conj(k2)); // 2a₂
  const k12 = add(k1, conj(k2));
  const k21 = add(k2, conj(k1));
  const d = sub(k1, k2);
  // f / e^{2m}（実数）
  let f = Math.exp(-2 * m);
  f += cdiv(pair(th1, th1), sq(k11))[0];
  f += cdiv(pair(th2, th2), sq(k22))[0];
  f += 2 * cdiv(pair(th1, th2), sq(k12))[0];
  f += (abs2(d) ** 2 * Math.exp(2 * th1[0] + 2 * th2[0] - 2 * m)) / (abs2(k11) * abs2(k22) * abs2(k12) ** 2);
  // g / e^{2m}
  let g = add(ex(th1, 2 * m), ex(th2, 2 * m));
  const d2 = sq(d);
  const e12 = add(th1, th2);
  const t1 = cdiv(ex(add(e12, conj(th1)), 2 * m), cmul(sq(k11), sq(k21)));
  const t2 = cdiv(ex(add(e12, conj(th2)), 2 * m), cmul(sq(k12), sq(k22)));
  g = add(g, cmul(d2, add(t1, t2)));
  return [g[0] / f, g[1] / f];
}

/**
 * NLS の 2 ソリトン衝突による位置のずれ（v₁ > v₂、Δ = (v₁ − v₂)/2）:
 *
 *     δx₁ = (1/a₁) log( (Δ² + (a₁+a₂)²) / (Δ² + (a₁−a₂)²) ),   δx₂ = −(a₁/a₂) δx₁.
 *
 * 速いソリトン 1 は前へ、遅いソリトン 2 は後ろへずれる（a₁δx₁ + a₂δx₂ = 0）。
 */
export function nlsTwoSolitonShifts(a1: number, a2: number, v1: number, v2: number): { fast: number; slow: number } {
  const delta = (v1 - v2) / 2;
  const r = Math.log((delta ** 2 + (a1 + a2) ** 2) / (delta ** 2 + (a1 - a2) ** 2));
  return { fast: r / a1, slow: -r / a2 };
}
