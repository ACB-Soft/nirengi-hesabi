import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, X, CheckCircle2, Share2, RefreshCw } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'up-to-date' | 'updated'>('idle');

  const handleCheckForUpdates = async () => {
    if (updateState === 'checking') return;
    setUpdateState('checking');

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) {
            setUpdateState('updated');
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(() => {
              window.location.reload();
            }, 1000);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('Service worker update check error:', err);
    }

    // Finished check, inform user that app is on latest version
    setTimeout(() => {
      setUpdateState('up-to-date');
      setTimeout(() => {
        setUpdateState('idle');
      }, 3000);
    }, 900);
  };

  // If already running as an installed PWA or previously installed, show "Güncelleştirmeleri Denetle"
  if (isInstalled) {
    return (
      <button
        onClick={handleCheckForUpdates}
        disabled={updateState === 'checking'}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-95 disabled:opacity-80 ${
          updateState === 'up-to-date'
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            : updateState === 'updated'
            ? 'bg-sky-950/40 border-sky-500/40 text-sky-300'
            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
        }`}
        title="Uygulama güncelleştirmelerini denetle"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${
            updateState === 'checking'
              ? 'animate-spin text-sky-400'
              : updateState === 'up-to-date'
              ? 'text-emerald-400'
              : 'text-slate-300'
          }`}
        />
        <span>
          {updateState === 'checking'
            ? 'Denetleniyor...'
            : updateState === 'up-to-date'
            ? 'Uygulama Güncel'
            : updateState === 'updated'
            ? 'Yeni Sürüm Yükleniyor...'
            : 'Güncelleştirmeleri Denetle'}
        </span>
      </button>
    );
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all cursor-pointer active:scale-95"
        title="Uygulamayı Cihazınıza Yükleyin"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Uygulamayı Yükle (PWA)</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-sm transition-all cursor-pointer active:scale-95"
          title="iOS Ana Ekrana Ekle"
        >
          <Smartphone className="w-3.5 h-3.5 text-sky-400" />
          <span>iOS'a Yükle</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-slate-800 border border-slate-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">iPhone / iPad'e Yükle</h3>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs text-slate-600">
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <Share2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800">1. Paylaş Butonuna Basın</strong>
                    <p className="mt-0.5 text-slate-500">Safari tarayıcısının altındaki Paylaş (kare ve yukarı ok) simgesine dokunun.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-800">2. Ana Ekrana Ekle</strong>
                    <p className="mt-0.5 text-slate-500">Açılan menüde aşağı kaydırarak <strong>"Ana Ekrana Ekle"</strong> seçeneğini seçin.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
              >
                Anladım
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback info button if ambient / desktop browser hasn't fired beforeinstallprompt yet
  return (
    <button
      onClick={() => {
        alert("PWA Kurulumu: Tarayıcınızın adres çubuğundaki 'Yükle' simgesine tıklayarak veya Chrome/Edge menüsünden 'GNSS Nivelman uygulamasını yükle' seçeneğini kullanarak uygulamayı masaüstünüze yükleyebilirsiniz.");
      }}
      className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-sm transition-all"
      title="PWA Kurulumu Hakkında"
    >
      <Download className="w-3.5 h-3.5 text-emerald-400" />
      <span>PWA</span>
    </button>
  );
};
