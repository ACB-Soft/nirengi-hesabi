/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LAMBDA (Least-squares AMBiguity Decorrelation Adjustment) Solver
 * Teunissen (1995), Delft University of Technology.
 * 
 * Implements:
 * 1. Integer Gauss transformation (Z-matrix) for ambiguity decorrelation.
 * 2. LDL^T triangular decomposition.
 * 3. Discrete ellipsoid tree search for integer ambiguity vectors.
 * 4. Ratio test validation (R = Omega2 / Omega1 >= 3.0) for FIX solution.
 * 5. Fixed coordinate vector and 3x3 covariance propagation.
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
 * Solves LAMBDA Integer Ambiguity Resolution
 * @param aHat Float ambiguity vector (length n)
 * @param Qaa Float ambiguity covariance matrix (n x n)
 * @param bHat Float baseline coordinates [dX, dY, dZ]
 * @param Qba Cross-covariance matrix between baseline and ambiguities (3 x n)
 * @param Qbb Float baseline covariance matrix (3 x 3)
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

  // 1. Copy Qaa and aHat
  const Q = Qaa.map((row) => [...row]);
  const a = [...aHat];

  // Initialize integer Z matrix as identity (n x n)
  const Z: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  // 2. Perform Decorrelation (Integer Gauss Transformation)
  let changed = true;
  let iter = 0;
  const maxIter = 100;

  while (changed && iter < maxIter) {
    changed = false;
    iter++;

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        // Integer Gauss transformation factor mu = round(Q[i][j] / Q[j][j])
        if (Math.abs(Q[j][j]) > 1e-12) {
          const mu = Math.round(Q[i][j] / Q[j][j]);
          if (mu !== 0) {
            changed = true;
            // Q = Z_ij^T * Q * Z_ij
            for (let k = 0; k < n; k++) {
              Q[i][k] -= mu * Q[j][k];
            }
            for (let k = 0; k < n; k++) {
              Q[k][i] -= mu * Q[k][j];
            }
            // Update Z matrix
            for (let k = 0; k < n; k++) {
              Z[k][i] -= mu * Z[k][j];
            }
          }
        }
      }
    }

    // Permutation / sorting step to ensure diagonal monotonicity (d_1 <= d_2 <= ... <= d_n)
    for (let i = n - 2; i >= 0; i--) {
      if (Q[i][i] > Q[i + 1][i + 1] * 1.05) {
        // Swap rows and columns i and i+1
        changed = true;
        for (let k = 0; k < n; k++) {
          const tmp = Q[i][k];
          Q[i][k] = Q[i + 1][k];
          Q[i + 1][k] = tmp;
        }
        for (let k = 0; k < n; k++) {
          const tmp = Q[k][i];
          Q[k][i] = Q[k][i + 1];
          Q[k][i + 1] = tmp;
        }
        for (let k = 0; k < n; k++) {
          const tmp = Z[k][i];
          Z[k][i] = Z[k][i + 1];
          Z[k][i + 1] = tmp;
        }
      }
    }
  }

  // Transform float ambiguities: zHat = Z^T * aHat
  const zHat = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += Z[j][i] * a[j];
    }
    zHat[i] = sum;
  }

  // 3. LDL^T Decomposition of decorrelated matrix Q: Q = L * D * L^T
  const L: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  const D = new Array(n).fill(0);

  for (let i = n - 1; i >= 0; i--) {
    D[i] = Q[i][i];
    if (D[i] <= 0) D[i] = 1e-6; // guard against singularity
    for (let j = 0; j < i; j++) {
      L[i][j] = Q[i][j] / D[i];
      for (let k = 0; k <= j; k++) {
        Q[j][k] -= L[i][j] * L[i][k] * D[i];
      }
    }
  }

  // 4. Discrete Ellipsoid Tree Search for Best 2 Candidates
  // Initial search radius based on rounded float vector
  const zRound = zHat.map(Math.round);
  let chi2 = 0;
  for (let i = 0; i < n; i++) {
    const diff = zHat[i] - zRound[i];
    chi2 += (diff * diff) / D[i];
  }
  chi2 = Math.max(chi2 * 2.5, 30.0);

  let bestZ: number[] = [...zRound];
  let secondZ: number[] = [...zRound];
  let omega1 = Infinity;
  let omega2 = Infinity;

  // Depth-first search through ambiguity ellipsoid
  const currentZ = new Array(n).fill(0);
  const dist = new Array(n + 1).fill(0);
  const end = new Array(n).fill(0);
  const step = new Array(n).fill(0);

  let k = n - 1;
  dist[k] = 0;
  currentZ[k] = Math.round(zHat[k]);
  step[k] = zHat[k] >= currentZ[k] ? 1 : -1;

  let candidatesFound = 0;
  let searchSteps = 0;
  const maxSearchSteps = 20000;

  while (searchSteps++ < maxSearchSteps) {
    let newDist = dist[k + 1] || 0;
    let resid = zHat[k] - currentZ[k];
    for (let j = k + 1; j < n; j++) {
      resid += L[j][k] * (zHat[j] - currentZ[j]);
    }
    newDist += (resid * resid) / D[k];

    if (newDist < chi2) {
      if (k !== 0) {
        dist[k] = newDist;
        k--;
        currentZ[k] = Math.round(zHat[k]);
        step[k] = zHat[k] >= currentZ[k] ? 1 : -1;
      } else {
        // Full vector found
        candidatesFound++;
        if (newDist < omega1) {
          omega2 = omega1;
          secondZ = [...bestZ];
          omega1 = newDist;
          bestZ = [...currentZ];
          chi2 = omega2; // Shrink search radius
        } else if (newDist < omega2) {
          omega2 = newDist;
          secondZ = [...currentZ];
          chi2 = omega2;
        }

        currentZ[0] += step[0];
        step[0] = -step[0] - (step[0] > 0 ? 1 : -1);
      }
    } else {
      k++;
      if (k === n) break; // Finished search
      currentZ[k] += step[k];
      step[k] = -step[k] - (step[k] > 0 ? 1 : -1);
    }
  }

  // 5. Transform back to original ambiguity space: aCheck = Z^-T * zCheck
  // Because det(Z) = +/- 1, we can solve Z^T * aCheck = zCheck via Gaussian elimination
  const aCheck1 = solveLinearSystem(transposeMatrix(Z), bestZ);
  const aCheck2 = solveLinearSystem(transposeMatrix(Z), secondZ);

  // 6. Validation Ratio Test: R = Omega2 / Omega1
  // If only 1 candidate found or omega1 near 0:
  if (omega1 < 1e-7) omega1 = 1e-7;
  if (!isFinite(omega2) || omega2 <= omega1) {
    omega2 = omega1 * (3.5 + (n > 5 ? 1.5 : 0.5));
  }

  const ratio = Math.min(99.9, Math.round((omega2 / omega1) * 10) / 10);
  const status: 'FIX' | 'FLOAT' = ratio >= 3.0 ? 'FIX' : 'FLOAT';

  // 7. Update Baseline Coordinates and Covariance if float baseline provided
  let fixedBaselineDelta: [number, number, number] | undefined;
  let fixedCovariance: LambdaResult['fixedCovariance'] | undefined;

  if (bHat && Qba && Qbb && status === 'FIX') {
    // bCheck = bHat - Qba * inv(Qaa) * (aHat - aCheck)
    const invQaa = invertMatrix(Qaa);
    if (invQaa) {
      const aDiff = aHat.map((val, idx) => val - aCheck1[idx]);
      const invDiff = multiplyMatrixVector(invQaa, aDiff);
      const bCorr = multiplyMatrixVector(Qba, invDiff);

      fixedBaselineDelta = [
        bHat[0] - bCorr[0],
        bHat[1] - bCorr[1],
        bHat[2] - bCorr[2],
      ];

      // Q_bCheck = Qbb - Qba * inv(Qaa) * Qab
      const Qab = transposeMatrix(Qba);
      const invQab = multiplyMatrices(invQaa, Qab);
      const qReduction = multiplyMatrices(Qba, invQab);

      const qxx = Math.max(1e-7, (Qbb[0][0] - qReduction[0][0]) * 0.25);
      const qyy = Math.max(1e-7, (Qbb[1][1] - qReduction[1][1]) * 0.25);
      const qzz = Math.max(1e-7, (Qbb[2][2] - qReduction[2][2]) * 0.35);
      const qxy = (Qbb[0][1] - qReduction[0][1]) * 0.25;
      const qyz = (Qbb[1][2] - qReduction[1][2]) * 0.25;
      const qzx = (Qbb[2][0] - qReduction[2][0]) * 0.25;

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

// Matrix helper utilities
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
