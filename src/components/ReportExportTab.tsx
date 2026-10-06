/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 7: Dengeleme Raporu ve Dışa Aktarım (Report & Export)
 * Kadastro & BÖHYY Standartlarına Uygun Dengeleme Karnesi
 */

import React from 'react';
import { JobConfig, AdjustmentResult, LoopClosure, Station } from '../types/gnss';
import { exportAdjustmentToExcel } from '../utils/geodesy';
import {
  FileText,
  Download,
  Printer,
  Table,
  CheckCircle2,
  AlertTriangle,
  Award,
} from 'lucide-react';

interface Props {
  config: JobConfig;
  adjustmentResult: AdjustmentResult | null;
  loopClosures: LoopClosure[];
  stations: Record<string, Station>;
}

export const ReportExportTab: React.FC<Props> = ({
  config,
  adjustmentResult,
  loopClosures,
  stations,
}) => {
  if (!adjustmentResult) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center space-y-3">
        <FileText className="w-12 h-12 text-slate-300 mx-auto" />
        <h3 className="text-base font-bold text-slate-800">Henüz Dengeleme Hesabı Yapılmadı</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Rapor ve çıktı alabilmek için lütfen "3D Ağ Dengelemesi" sekmesinden veya F8 kısayolu ile 
          dengeleme hesabını çalıştırınız.
        </p>
      </div>
    );
  }

  const handleExportExcel = () => {
    exportAdjustmentToExcel(config, adjustmentResult, loopClosures);
  };

  const handleExportTxt = () => {
    let reportTxt = `================================================================================\n`;
    reportTxt += `       TUREF / ITRF96 GNSS 3D AĞ DENGELEME VE HESAP RAPORU\n`;
    reportTxt += `  (Büyük Ölçekli Harita ve Harita Bilgileri Üretim Yönetmeliği Standartlarında)\n`;
    reportTxt += `================================================================================\n\n`;

    reportTxt += `PROJE BİLGİLERİ:\n`;
    reportTxt += `Proje Adı           : ${config.projectName}\n`;
    reportTxt += `Mühendis / Firma    : ${config.surveyor}\n`;
    reportTxt += `İdare / Kurum       : ${config.institution}\n`;
    reportTxt += `Koordinat Sistemi   : ${config.crsSystem} (DOM: ${config.dom} Derece)\n`;
    reportTxt += `Referans Elipsoidi  : ${config.ellipsoid} (a=6378137.0 m, 1/f=298.257222101)\n`;
    reportTxt += `Ölçü Epoğu (t)      : ${config.surveyEpoch.toFixed(2)}\n`;
    reportTxt += `Referans Epoğu      : ${config.refEpoch.toFixed(2)}\n`;
    reportTxt += `Dengeleme Modu      : ${adjustmentResult.mode === 'constrained' ? 'Dayalı (CORS Sabit)' : 'Serbest (İç Tutarlılık)'}\n`;
    reportTxt += `Hesaplama Tarihi    : ${new Date().toLocaleString('tr-TR')}\n\n`;

    reportTxt += `DENGELEME İSTATİSTİKLERİ:\n`;
    reportTxt += `Birim Ölçü St. Hatası (sigma_0) : ${adjustmentResult.sigma0Aposteriori.toFixed(4)}\n`;
    reportTxt += `Serbestlik Derecesi (DOF)       : ${adjustmentResult.dof}\n`;
    reportTxt += `Toplam Ölçü Sayısı (3*m)        : ${adjustmentResult.totalObservations}\n`;
    reportTxt += `Toplam Bilinmeyen Sayısı (3*u)  : ${adjustmentResult.totalUnknowns}\n`;
    reportTxt += `Kalıntı Kareler Toplamı [vPv]   : ${adjustmentResult.vPv.toFixed(6)}\n`;
    reportTxt += `Ki-Kare Testi (95% Güven)       : ${adjustmentResult.chiSquareTest.passed ? 'GEÇTİ (Model Uyumlu)' : 'KRİTİK UYARI'}\n`;
    reportTxt += `Baarda w-testi Kaba Hatalar     : ${adjustmentResult.outliers.length > 0 ? adjustmentResult.outliers.join(', ') : 'Kaba Hata Tespit Edilmedi'}\n\n`;

    reportTxt += `--------------------------------------------------------------------------------\n`;
    reportTxt += `DENGELENMİŞ KOORDİNATLAR VE HATA ELİPSLERİ:\n`;
    reportTxt += `Nokta       X(m)         Y(m)         Z(m)       TM-Y(m)      TM-X(m)      H(m)    sX(mm)  sY(mm)  sZ(mm)   a(mm)   b(mm) Az(G)\n`;
    reportTxt += `--------------------------------------------------------------------------------\n`;

    Object.values(adjustmentResult.stations).forEach((st) => {
      const name = st.name.padEnd(10);
      const x = (st.adjustedX ?? st.x).toFixed(4).padStart(12);
      const y = (st.adjustedY ?? st.y).toFixed(4).padStart(12);
      const z = (st.adjustedZ ?? st.z).toFixed(4).padStart(12);
      const py = (st.adjustedProjY ?? st.projY).toFixed(3).padStart(12);
      const px = (st.adjustedProjX ?? st.projX).toFixed(3).padStart(12);
      const h = (st.adjustedH ?? st.h).toFixed(3).padStart(9);
      const sx = (st.sigmaX ?? 0).toFixed(1).padStart(7);
      const sy = (st.sigmaY ?? 0).toFixed(1).padStart(7);
      const sz = (st.sigmaZ ?? 0).toFixed(1).padStart(7);
      const a = (st.semiMajor ?? 0).toFixed(1).padStart(7);
      const b = (st.semiMinor ?? 0).toFixed(1).padStart(7);
      const az = (st.ellipseAzimuth ?? 0).toFixed(1).padStart(6);

      reportTxt += `${name} ${x} ${y} ${z} ${py} ${px} ${h} ${sx} ${sy} ${sz} ${a} ${b} ${az}\n`;
    });

    reportTxt += `\n--------------------------------------------------------------------------------\n`;
    reportTxt += `BAZ VEKTÖRLERİ VE DÜZELTME KALINTILARI:\n`;
    reportTxt += `BazID       Başlangıç->Bitiş     Uzunluk(m)    dX(m)       dY(m)       dZ(m)      vx(mm)   vy(mm)   vz(mm)  vMek(mm)  w-Test\n`;
    reportTxt += `--------------------------------------------------------------------------------\n`;

    adjustmentResult.baselines.forEach((b) => {
      const id = b.id.padEnd(10);
      const route = `${b.fromId}->${b.toId}`.padEnd(20);
      const len = b.length.toFixed(2).padStart(12);
      const dx = b.dX.toFixed(3).padStart(11);
      const dy = b.dY.toFixed(3).padStart(11);
      const dz = b.dZ.toFixed(3).padStart(11);
      const vx = (b.vX ?? 0).toFixed(1).padStart(8);
      const vy = (b.vY ?? 0).toFixed(1).padStart(8);
      const vz = (b.vZ ?? 0).toFixed(1).padStart(8);
      const vm = (b.spatialV ?? 0).toFixed(1).padStart(9);
      const wt = (b.wTest ?? 0).toFixed(2).padStart(7);

      reportTxt += `${id} ${route} ${len} ${dx} ${dy} ${dz} ${vx} ${vy} ${vz} ${vm} ${wt}\n`;
    });

    const blob = new Blob([reportTxt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.projectName.replace(/\s+/g, '_')}_Dengeleme_Raporu.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Action Buttons Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-sky-100 text-sky-800 text-xs font-semibold px-2 py-0.5 rounded">
                MODÜL 7
              </span>
              <h2 className="text-base font-bold text-slate-900">
                Resmi Dengeleme Raporu ve Çıktı Alma
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Kadastro Genel Müdürlüğü ve BÖHYY standartlarında onaylanabilir hesap karnesi ve veri dışa aktarımı.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel (.xlsx) İndir</span>
            </button>

            <button
              onClick={handleExportTxt}
              className="px-3.5 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Metin Raporu (.txt) İndir</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-3.5 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Yazdır / PDF Kaydet</span>
            </button>
          </div>
        </div>
      </div>

      {/* Official Formatted Geodetic Report Sheet */}
      <div className="bg-white rounded-xl shadow-md border border-slate-200 p-8 space-y-6 text-slate-800 print:shadow-none print:border-none print:p-0">
        {/* Report Header */}
        <div className="text-center border-b-2 border-slate-900 pb-4 space-y-1">
          <div className="text-xs font-bold tracking-widest text-slate-500 uppercase">
            T.C. HARİTA GENEL MÜDÜRLÜĞÜ & BÖHYY STANDARTLARI
          </div>
          <h1 className="text-xl font-black text-slate-900 uppercase">
            GNSS 3D AĞ DENGELEME VE HESAP KARNESİ
          </h1>
          <div className="text-xs text-slate-600">
            {config.projectName} - {config.crsSystem} (DOM: {config.dom}&deg;)
          </div>
        </div>

        {/* Project Meta Table */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border border-slate-200 rounded-lg p-4 bg-slate-50 print:bg-transparent">
          <div>
            <span className="text-slate-500 block">Proje Adı:</span>
            <strong className="text-slate-900">{config.projectName}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">Mühendis / Firma:</span>
            <strong className="text-slate-900">{config.surveyor}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">Referans Elipsoidi:</span>
            <strong className="text-slate-900">GRS80 (a=6378137.0 m)</strong>
          </div>
          <div>
            <span className="text-slate-500 block">Epoklar (t / Ref):</span>
            <strong className="text-slate-900">
              {config.surveyEpoch.toFixed(2)} / {config.refEpoch.toFixed(2)}
            </strong>
          </div>
        </div>

        {/* Adjustment Summary Metrics */}
        <div className="border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
          <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2">
            Dengeleme İstatistikleri ve Global Model Testleri
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-slate-500">Birim Ölçü Hatası ($\sigma_0$):</span>
              <div className="font-mono font-bold text-slate-900">{adjustmentResult.sigma0Aposteriori.toFixed(4)}</div>
            </div>
            <div>
              <span className="text-slate-500">Serbestlik Derecesi (DOF):</span>
              <div className="font-mono font-bold text-slate-900">{adjustmentResult.dof}</div>
            </div>
            <div>
              <span className="text-slate-500">Kalıntı Kareler Toplamı [vPv]:</span>
              <div className="font-mono font-bold text-slate-900">{adjustmentResult.vPv.toFixed(4)}</div>
            </div>
            <div>
              <span className="text-slate-500">Ki-Kare Testi (95%):</span>
              <div className="font-bold text-emerald-700">
                {adjustmentResult.chiSquareTest.passed ? 'GEÇTİ (Model Uyumlu)' : 'KRİTİK UYARI'}
              </div>
            </div>
          </div>
        </div>

        {/* Adjusted Coordinates Table */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            1. Dengelenmiş Koordinatlar ve %95 Güven Aralıklı Hata Elipsleri
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-[11px] border-collapse font-mono">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-sans font-bold border-b border-slate-200">
                  <th className="p-2">Nokta</th>
                  <th className="p-2 text-right">TM Sağa Y (m)</th>
                  <th className="p-2 text-right">TM Yukarı X (m)</th>
                  <th className="p-2 text-right">Elip. H (m)</th>
                  <th className="p-2 text-right">$\sigma_X$ (mm)</th>
                  <th className="p-2 text-right">$\sigma_Y$ (mm)</th>
                  <th className="p-2 text-right">a (mm)</th>
                  <th className="p-2 text-right">b (mm)</th>
                  <th className="p-2 text-right">Azimut (G)</th>
                  <th className="p-2 text-right">$\sigma_H$ (mm)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {Object.values(adjustmentResult.stations).map((st) => (
                  <tr key={st.id}>
                    <td className="p-2 font-sans font-bold text-slate-900">{st.name}</td>
                    <td className="p-2 text-right">{(st.adjustedProjY ?? st.projY).toFixed(3)}</td>
                    <td className="p-2 text-right">{(st.adjustedProjX ?? st.projX).toFixed(3)}</td>
                    <td className="p-2 text-right">{(st.adjustedH ?? st.h).toFixed(3)}</td>
                    <td className="p-2 text-right">{(st.sigmaX ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right">{(st.sigmaY ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right font-bold text-sky-800">{(st.semiMajor ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right">{(st.semiMinor ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right">{(st.ellipseAzimuth ?? 0).toFixed(2)}</td>
                    <td className="p-2 text-right">{(st.sigmaH ?? 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Baselines and Residuals Table */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            2. Baz Vektörleri, Düzeltmeler ve Baarda Data Snooping (w-Testi)
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-[11px] border-collapse font-mono">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-sans font-bold border-b border-slate-200">
                  <th className="p-2">Baz ID</th>
                  <th className="p-2">Güzergah</th>
                  <th className="p-2 text-right">Uzunluk (m)</th>
                  <th className="p-2 text-right">dX (m)</th>
                  <th className="p-2 text-right">dY (m)</th>
                  <th className="p-2 text-right">dZ (m)</th>
                  <th className="p-2 text-right">vX (mm)</th>
                  <th className="p-2 text-right">vY (mm)</th>
                  <th className="p-2 text-right">vZ (mm)</th>
                  <th className="p-2 text-right">v_Mekan (mm)</th>
                  <th className="p-2 text-right">Baarda w</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {adjustmentResult.baselines.map((b) => (
                  <tr key={b.id} className={b.isOutlier ? 'bg-rose-50' : ''}>
                    <td className="p-2 font-sans font-bold">{b.id}</td>
                    <td className="p-2 font-sans">{b.fromId} &rarr; {b.toId}</td>
                    <td className="p-2 text-right">{b.length.toFixed(2)}</td>
                    <td className="p-2 text-right">{b.dX.toFixed(3)}</td>
                    <td className="p-2 text-right">{b.dY.toFixed(3)}</td>
                    <td className="p-2 text-right">{b.dZ.toFixed(3)}</td>
                    <td className="p-2 text-right">{(b.vX ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right">{(b.vY ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right">{(b.vZ ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right font-bold">{(b.spatialV ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right font-bold">
                      {(b.wTest ?? 0).toFixed(2)} {b.isOutlier ? '*' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Loop Closures Table */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            3. Döngü Kapanış (Loop Closure) Analizi
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-[11px] border-collapse font-mono">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-sans font-bold border-b border-slate-200">
                  <th className="p-2">Döngü ID</th>
                  <th className="p-2">Güzergah</th>
                  <th className="p-2 text-right">Çevre (km)</th>
                  <th className="p-2 text-right">w (mm)</th>
                  <th className="p-2 text-right">Tolerans (mm)</th>
                  <th className="p-2 text-right">Bağıl Kapanış</th>
                  <th className="p-2 text-center font-sans">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loopClosures.map((l) => (
                  <tr key={l.id}>
                    <td className="p-2 font-sans font-bold">{l.id}</td>
                    <td className="p-2 font-sans">{l.stationIds.join(' - ')}</td>
                    <td className="p-2 text-right">{l.totalLengthKm.toFixed(2)}</td>
                    <td className="p-2 text-right font-bold">{l.totalMisclosure.toFixed(1)}</td>
                    <td className="p-2 text-right">{l.toleranceMm.toFixed(1)}</td>
                    <td className="p-2 text-right">{l.relativePrecision}</td>
                    <td className="p-2 text-center font-sans font-bold">
                      <span className={l.isAccepted ? 'text-emerald-700' : 'text-rose-700'}>
                        {l.isAccepted ? 'UYGUN' : 'AŞILDI'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Signature Box */}
        <div className="grid grid-cols-2 pt-12 text-center text-xs">
          <div>
            <div className="font-bold text-slate-900">Hesaplayan Jeodezi Mühendisi</div>
            <div className="text-slate-500 mt-1">{config.surveyor}</div>
            <div className="h-14 border-b border-dashed border-slate-300 w-48 mx-auto mt-2"></div>
            <div className="text-[10px] text-slate-400 mt-1">İmza / Kaşe</div>
          </div>
          <div>
            <div className="font-bold text-slate-900">Kontrol Eden / İdare Yetkilisi</div>
            <div className="text-slate-500 mt-1">{config.institution}</div>
            <div className="h-14 border-b border-dashed border-slate-300 w-48 mx-auto mt-2"></div>
            <div className="text-[10px] text-slate-400 mt-1">İmza / Mühür</div>
          </div>
        </div>
      </div>
    </div>
  );
};
