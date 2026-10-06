/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Teknik Dokümantasyon & Jeodezik Matematiksel Modeller
 */

import React from 'react';
import { BookOpen, Compass, Layers, ShieldCheck, Cpu } from 'lucide-react';

export const TechnicalDocsTab: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-xl p-5 shadow-sm border border-slate-700">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-bold">Jeodezik ve Matematiksel Modeller Dokümantasyonu</h2>
        </div>
        <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
          T.C. BÖHYY (Büyük Ölçekli Harita ve Harita Bilgileri Üretim Yönetmeliği), IGS/IERS konvansiyonları, 
          RTKLIB statik çift fark faz çözümü, ANTEX v1.4 anten modellemesi ve 3D Gauss-Markov ağ dengeleme matematiği.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-700">
        {/* Modül 1 & 2: Elipsoit ve ANTEX */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Compass className="w-4 h-4 text-sky-600" />
            <h3 className="text-sm">1. GRS80 Elipsoidi ve ANTEX v1.4 Anten Modeli</h3>
          </div>
          <div className="space-y-2">
            <p>
              <strong>GRS80 Parametreleri:</strong> Yarı büyük eksen a = 6,378,137.0 m, basıklık tersi 1/f = 298.257222101. 
              Birinci dışmerkezlik karesi e² = 2f - f² = 0.00669438002290.
            </p>
            <div className="bg-slate-50 p-2.5 rounded font-mono text-[11px] border border-slate-200 space-y-1">
              <div>// Anten Düşey Yükseklik İndirgemesi (ARP)</div>
              <div>Vertical (Pilye): h_vert = measured_h - offset</div>
              <div>Slant (Sehpa/Jalon): h_vert = sqrt(R_slant² - R_ant²) - offset</div>
            </div>
            <p>
              <strong>ANTEX (v1.4) PCO & PCV:</strong> Faz merkezi ofsetleri (PCO_L1, PCO_L2) anten ARP noktasından faz merkezine 
              (North, East, Up) vektörleridir. İyonosfersiz (IF) doğrusal bileşim için:
              <br />
              <code>PCO_IF = 2.546 × PCO_L1 - 1.546 × PCO_L2</code>
            </p>
          </div>
        </div>

        {/* Modül 3: RTKLIB Çift Fark */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Cpu className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm">2. Çift Fark (Double Difference) Faz Gözlemi</h3>
          </div>
          <div className="space-y-2">
            <p>
              İki alıcı (A, B) ve iki uydu (j, k) arasındaki çift fark faz gözlem denklemi uydu ve alıcı saat hatalarını tamamen yok eder:
            </p>
            <div className="bg-slate-50 p-2.5 rounded font-mono text-[11px] border border-slate-200">
              ∇ΔΦ_AB^jk = ∇Δρ_AB^jk + λ·∇ΔN_AB^jk - ∇ΔI_AB^jk + ∇ΔT_AB^jk + ε
            </div>
            <p>
              RTKLIB rnx2rtkp motoru LAMBDA algoritması ile tamsayı belirsizliklerini (Ambiguities) çözer. Ratio ≥ 3.0 ise çözüm Q=1 (Fix) kabul edilir.
            </p>
          </div>
        </div>

        {/* Modül 4: Çizge Teorisi Loop Closure */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 border-b border-slate-100 pb-2">
            <Layers className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm">3. Çizge Teorisi ve Döngü Kapanış (Loop Closure)</h3>
          </div>
          <div className="space-y-2">
            <p>
              Ağ bir yönsüz çizge G = (V, E) olarak modellenir. Kapsayan Ağaç (Spanning Tree) derinlik öncelikli arama (DFS) ile temel döngü tabanı (Cycle Basis) türetilir.
            </p>
            <div className="bg-slate-50 p-2.5 rounded font-mono text-[11px] border border-slate-200 space-y-1">
              <div>w_X = Σ (s_i × dX_i),  w_Y = Σ (s_i × dY_i),  w_Z = Σ (s_i × dZ_i)</div>
              <div>Toplam 3D Kapanış Hatası: w = sqrt(w_X² + w_Y² + w_Z²)</div>
              <div>BÖHYY Tolerans Denetimi: T = 10 mm + 1.0 ppm × S</div>
            </div>
          </div>
        </div>

        {/* Modül 5: 3D Gauss-Markov & Baarda */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 border-b border-slate-100 pb-2">
            <ShieldCheck className="w-4 h-4 text-rose-600" />
            <h3 className="text-sm">4. 3D Gauss-Markov Dengelemesi ve Baarda Snooping</h3>
          </div>
          <div className="space-y-2">
            <div className="bg-slate-50 p-2.5 rounded font-mono text-[11px] border border-slate-200 space-y-1">
              <div>v = A·x̂ - l,  P = σ₀²·Σ⁻¹</div>
              <div>N = Aᵀ·P·A,  x̂ = N⁻¹·Aᵀ·P·l</div>
              <div>σ₀ = sqrt(vᵀ·P·v / DOF),  Σ_xx = σ₀²·N⁻¹</div>
              <div>Baarda w-testi: w_i = |v_i| / (σ₀ × sqrt(Q_vv[i,i])) ≤ 3.29</div>
            </div>
            <p>
              Baarda w-testi serbestlik derecesine bağlı olarak standart normal dağılım uyarınca α = 0.001 anlamlılık düzeyinde 
              w &gt; 3.29 olan baz vektörlerini kaba hata (outlier) olarak ayıklar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
