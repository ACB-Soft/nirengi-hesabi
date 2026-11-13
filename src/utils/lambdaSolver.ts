/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LAMBDA (Least-squares AMBiguity Decorrelation Adjustment) / MLAMBDA Solver
 * Teunissen (1995) & Chang, Yang, Zhou (2005).
 *
 * Implements:
 * 1. Exact Q = L^T * D * L factorization.
 * 2. Integer Gauss Transformations (IGTs) + adjacent diagonal permutations on (L, D, Z).
 * 3. Schnorr-Euchner discrete ellipsoid tree search for top-2 integer ambiguity vectors.
 * 4. Ratio test validation (R = Omega2 / Omega1 >= 3.0) for FIX solution.
 * 5. Exact Schur-complement fixed baseline vector and 3x3 covariance propagation.
 */

export interface LambdaResult {
  status: 'FIX' | 'FLOAT';
  ratio: number;
  bestAmbiguities: number[];
  secondBestAmbiguities: number[];
  omega1: number;
  omega2: number;
  fixedBaselineDelta?: [number, number, number];
  fixedCovariance?: {
    qxx: number;
    qyy: number;
    qzz: number;
    qxy: number;
    qyz: number;
    qzx: number;
  };
}

/**
 * Exact backward factorization Q = L^T * D * L where L is unit lower triangular
 */
function ldFactorization(Qorig: number[][]): { L: number[][]; D: number[] } | null {
  const n = Qorig.length;
  const Q = Qorig.map((row) => [...row]);
  const L: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0))
  );
  const D = new Array<number>(n).fill(0);

  for (let i = n - 1; i >= 0; i--) {
    const diag = Q[i][i];
    if (!isFinite(diag) || diag <= 1e-12) {
      return null;
    }
    D[i] = diag;
    for (let j = 0; j < i; j++) {
      const a = Q[i][j];
      const lij = a / diag;
      L[i][j] = lij;
      for (let k = 0; k <= j; k++) {
        Q[j][k] -= a * L[i][k];
      }
    }
  }
  return { L, D };
}

/**
 * Integer Gauss Transformation & Diagonal Permutation on L^T * D * L
 */
function lambdaReduction(L: number[][], D: number[], Z: number[][]): void {
  const n = D.length;

  const gauss = (i: number, j: number) => {
    const mu = Math.round(L[i][j]);
    if (mu === 0) return;
    for (let k = i; k < n; k++) {
      L[k][j] -= mu * L[k][i];
    }
    for (let k = 0; k < n; k++) {
      Z[k][j] -= mu * Z[k][i];
    }
  };

  const perm = (i: number) => {
    const lam = L[i + 1][i];
    const delta = D[i] + lam * lam * D[i + 1];
    const eta = D[i] / delta;
    const lamPrime = (lam * D[i + 1]) / delta;

    D[i] = D[i + 1] * eta;
    D[i + 1] = delta;
    L[i + 1][i] = lamPrime;

    for (let j = 0; j < i; j++) {
      const lij = L[i][j];
      const li1j = L[i + 1][j];
      L[i][j] = li1j - lam * lij;
      L[i + 1][j] = eta * lij + lamPrime * li1j;
    }
    for (let k = i + 2; k < n; k++) {
      const tmp = L[k][i];
      L[k][i] = L[k][i + 1];
      L[k][i + 1] = tmp;
    }
    for (let r = 0; r < n; r++) {
      const tmp = Z[r][i];
      Z[r][i] = Z[r][i + 1];
      Z[r][i + 1] = tmp;
    }
  };

  let k = n - 2;
  let guard = 0;
  const maxReductionSteps = 10000;

  while (k >= 0 && guard++ < maxReductionSteps) {
    for (let j = k + 1; j < n; j++) {
      gauss(j, k);
    }
    const delta = D[k] + L[k + 1][k] * L[k + 1][k] * D[k + 1];
    if (delta + 1e-10 < D[k + 1]) {
      perm(k);
      k = Math.min(n - 2, k + 1);
    } else {
      k--;
    }
  }
}

/**
 * Schnorr-Euchner Ellipsoid Search for Best 2 Integer Vectors in Z-space
 */
function lambdaSearch(
  L: number[][],
  D: number[],
  zHat: number[]
): { bestZ: number[]; secondZ: number[]; omega1: number; omega2: number } {
  const n = zHat.length;
  const z = new Array<number>(n).fill(0);
  const zb = new Array<number>(n).fill(0);
  const v = new Array<number>(n).fill(0);
  const step = new Array<number>(n).fill(0);
  const dist = new Array<number>(n + 1).fill(0);

  let bestZ = zHat.map(Math.round);
  let secondZ = zHat.map(Math.round);
  let omega1 = Infinity;
  let omega2 = Infinity;
  let maxdist = Infinity;

  const computeCondCenter = (level: number): number => {
    let c = zHat[level];
    for (let j = level + 1; j < n; j++) {
      c -= L[j][level] * v[j];
    }
    return c;
  };

  let k = n - 1;
  dist[n] = 0;
  zb[k] = zHat[k];
  z[k] = Math.round(zb[k]);
  v[k] = zb[k] - z[k];
  step[k] = v[k] >= 0 ? 1 : -1;

  let searchSteps = 0;
  const maxSearchSteps = 80000;

  while (searchSteps++ < maxSearchSteps) {
    const newDist = dist[k + 1] + (v[k] * v[k]) / D[k];

    if (newDist < maxdist) {
      if (k !== 0) {
        dist[k] = newDist;
        k--;
        zb[k] = computeCondCenter(k);
        z[k] = Math.round(zb[k]);
        v[k] = zb[k] - z[k];
        step[k] = v[k] >= 0 ? 1 : -1;
      } else {
        if (newDist < omega1) {
          omega2 = omega1;
          secondZ = [...bestZ];
          omega1 = newDist;
          bestZ = [...z];
        } else if (newDist < omega2) {
          omega2 = newDist;
          secondZ = [...z];
        }
        if (isFinite(omega2)) {
          maxdist = omega2;
        }
        // Try next integer at level 0
        z[0] += step[0];
        v[0] = zb[0] - z[0];
        step[0] = -step[0] - (step[0] > 0 ? 1 : -1);
      }
    } else {
      if (k === n - 1) {
        break;
      }
      k++;
      z[k] += step[k];
      v[k] = zb[k] - z[k];
      step[k] = -step[k] - (step[k] > 0 ? 1 : -1);
    }
  }

  return { bestZ, secondZ, omega1, omega2 };
}

/**
 * Solves LAMBDA Integer Ambiguity Resolution
 */
export function solveLambda(
  aHat: number[],
  Qaa: number[][],
  bHat?: [number, number, number],
  Qba?: number[][],
  Qbb?: number[][]
): LambdaResult {
  const n = aHat.length;
  if (n === 0) {
    return {
      status: 'FLOAT',
      ratio: 1.0,
      bestAmbiguities: [],
      secondBestAmbiguities: [],
      omega1: 0,
      omega2: 0,
    };
  }

  // Symmetrize Qaa cleanly
  const Qsym: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => 0.5 * (Qaa[i][j] + Qaa[j][i]))
  );

  const ld = ldFactorization(Qsym);
  if (!ld) {
    return {
      status: 'FLOAT',
      ratio: 1.0,
      bestAmbiguities: aHat.map(Math.round),
      secondBestAmbiguities: aHat.map(Math.round),
      omega1: 0,
      omega2: 0,
    };
  }

  const { L, D } = ld;
  const Z: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  // Decorrelate (L, D, Z)
  lambdaReduction(L, D, Z);

  // Transform float ambiguities: zHat = Z^T * aHat
  const zHat = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += Z[j][i] * aHat[j];
    }
    zHat[i] = sum;
  }

  // Discrete ellipsoid search for top 2 integer candidates
  const { bestZ, secondZ, omega1, omega2 } = lambdaSearch(L, D, zHat);

  // Back-transform to original ambiguity space: Z^T * aCheck = zCheck
  const ZT = transposeMatrix(Z);
  const aCheck1 = solveLinearSystem(ZT, bestZ);
  const aCheck2 = solveLinearSystem(ZT, secondZ);

  if (!isFinite(omega1) || !isFinite(omega2) || omega2 <= omega1) {
    return {
      status: 'FLOAT',
      ratio: 1.0,
      bestAmbiguities: aCheck1.map(Math.round),
      secondBestAmbiguities: aCheck2.map(Math.round),
      omega1: isFinite(omega1) ? omega1 : 0,
      omega2: isFinite(omega2) ? omega2 : 0,
    };
  }

  const safeOmega1 = Math.max(1e-9, omega1);
  const ratio = Math.min(99.9, Math.round((omega2 / safeOmega1) * 10) / 10);
  const status: 'FIX' | 'FLOAT' = ratio >= 3.0 ? 'FIX' : 'FLOAT';

  let fixedBaselineDelta: [number, number, number] | undefined;
  let fixedCovariance: LambdaResult['fixedCovariance'] | undefined;

  if (bHat && Qba && Qbb && status === 'FIX') {
    const invQaa = invertMatrix(Qsym);
    if (invQaa) {
      const aDiff = aHat.map((val, idx) => val - Math.round(aCheck1[idx]));
      const invDiff = multiplyMatrixVector(invQaa, aDiff);
      const bCorr = multiplyMatrixVector(Qba, invDiff);

      fixedBaselineDelta = [
        bHat[0] - bCorr[0],
        bHat[1] - bCorr[1],
        bHat[2] - bCorr[2],
      ];

      const Qab = transposeMatrix(Qba);
      const invQab = multiplyMatrices(invQaa, Qab);
      const qReduction = multiplyMatrices(Qba, invQab);

      const qxx = Math.max(1e-9, Qbb[0][0] - qReduction[0][0]);
      const qyy = Math.max(1e-9, Qbb[1][1] - qReduction[1][1]);
      const qzz = Math.max(1e-9, Qbb[2][2] - qReduction[2][2]);
      const qxy = Qbb[0][1] - qReduction[0][1];
      const qyz = Qbb[1][2] - qReduction[1][2];
      const qzx = Qbb[2][0] - qReduction[2][0];

      fixedCovariance = { qxx, qyy, qzz, qxy, qyz, qzx };
    }
  }

  return {
    status,
    ratio,
    bestAmbiguities: aCheck1.map(Math.round),
    secondBestAmbiguities: aCheck2.map(Math.round),
    omega1,
    omega2,
    fixedBaselineDelta,
    fixedCovariance,
  };
}

function transposeMatrix(A: number[][]): number[][] {
  const m = A.length;
  const n = A[0].length;
  const AT: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      AT[j][i] = A[i][j];
    }
  }
  return AT;
}

function multiplyMatrices(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0].length;
  const n = B[0].length;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let p = 0; p < k; p++) {
        sum += A[i][p] * B[p][j];
      }
      C[i][j] = sum;
    }
  }
  return C;
}

function multiplyMatrixVector(A: number[][], v: number[]): number[] {
  const m = A.length;
  const n = v.length;
  const res = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += A[i][j] * v[j];
    }
    res[i] = sum;
  }
  return res;
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    const tmp = M[i];
    M[i] = M[maxRow];
    M[maxRow] = tmp;

    if (Math.abs(M[i][i]) < 1e-12) continue;

    for (let k = i + 1; k < n; k++) {
      const c = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) {
        M[k][j] -= c * M[i][j];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = Math.abs(M[i][i]) > 1e-12 ? sum / M[i][i] : 0;
  }
  return x;
}

function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    const tmp = M[i];
    M[i] = M[maxRow];
    M[maxRow] = tmp;

    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-14) return null;

    for (let j = 0; j < 2 * n; j++) {
      M[i][j] /= pivot;
    }

    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = M[k][i];
        for (let j = 0; j < 2 * n; j++) {
          M[k][j] -= factor * M[i][j];
        }
      }
    }
  }

  return M.map((row) => row.slice(n));
}
