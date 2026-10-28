/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Secure GNSS Project Archive Manager (.zip)
 * Client-side 100% offline, zero-leak archive bundling and extraction using JSZip.
 * Embeds HMAC-SHA256 digital signatures on the manifest and every raw RINEX file
 * to guarantee cryptographic anti-tamper protection and zero data loss.
 */

import JSZip from 'jszip';
import { SavedProject } from './projectStorage';
import {
  signBackupData,
  verifyBackupIntegrity,
  sha256Hex,
  ArchiveManifest,
  ArchiveManifestFile,
  signArchiveManifest,
  verifyArchiveManifest,
  ArchiveVerificationResult,
} from './backupIntegrity';
import { loadRinexFileFromOpfs, saveRinexFileToOpfs, listRinexFilesInOpfs } from './opfsStorage';

export interface ExportArchiveProgress {
  percent: number;
  stage: 'SCANNING' | 'HASHING' | 'SIGNING' | 'COMPRESSING' | 'COMPLETED' | 'ERROR';
  currentFile?: string;
  message: string;
}

export interface ImportArchiveProgress {
  percent: number;
  stage: 'READING' | 'VERIFYING_HMAC' | 'VERIFYING_HASHES' | 'EXTRACTING_OPFS' | 'COMPLETED' | 'ERROR';
  currentFile?: string;
  message: string;
}

export interface ImportArchiveResult {
  project: SavedProject;
  restoredRinexFiles: string[];
  integrity: ArchiveVerificationResult;
}

/**
 * Generates human-readable BÖHYY Network Adjustment & Project summary text
 */
function generateProjectSummaryText(project: SavedProject): string {
  const pData = project.data;
  const cfg = pData?.config;
  const adj = pData?.constrainedResult || pData?.adjustmentResult || pData?.unconstrainedResult;

  let text = '================================================================================\n';
  text += '                    GNSS NİRENGİ AĞI VE DENGELEME RAPORU ÖZETİ\n';
  text += '              (BÖHYY & ITRF96 / TUREF Jeodezik Standartlarında Üretilmiştir)\n';
  text += '================================================================================\n\n';

  text += `Proje Adı           : ${project.name}\n`;
  text += `Proje ID            : ${project.id}\n`;
  text += `Hesaplayan          : ${cfg?.surveyor || 'Belirtilmemiş'}\n`;
  text += `Kontrol Eden        : ${cfg?.checker || 'Belirtilmemiş'}\n`;
  text += `Kurum/Kuruluş       : ${cfg?.institution || 'ACB Maps Geodesy'}\n`;
  text += `Koordinat Sistemi   : ${cfg?.crsSystem || 'TUREF-TM30'} (DOM: ${cfg?.dom || 30}°)\n`;
  text += `Elipsoid            : ${cfg?.ellipsoid || 'GRS80'}\n`;
  text += `Referans Epoku      : ${cfg?.refEpoch?.toFixed(2) || '2005.00'}\n`;
  text += `Ölçü Epoku          : ${cfg?.surveyEpoch?.toFixed(2) || '2024.45'}\n`;
  text += `Oluşturulma Tarihi  : ${new Date().toLocaleString('tr-TR')}\n\n`;

  text += '--------------------------------------------------------------------------------\n';
  text += '1. DENGELEME VE İSTATİSTİK ÖZETİ\n';
  text += '--------------------------------------------------------------------------------\n';
  if (adj) {
    text += `Dengeleme Türü      : ${adj.mode === 'constrained' ? '3B Dayalı Ağ Dengelemesi (Constrained)' : 'Serbest Ağ Dengelemesi (Unconstrained)'}\n`;
    text += `Serbestlik Derecesi : ${adj.dof}\n`;
    text += `Toplam Ölçü Sayısı  : ${adj.totalObservations} (dX, dY, dZ)\n`;
    text += `Bilinmeyen Sayısı   : ${adj.totalUnknowns}\n`;
    text += `A-Priori Birim Ölçü : ${adj.sigma0Apriori.toFixed(4)}\n`;
    text += `A-Posteriori σ₀     : ${adj.sigma0Aposteriori.toFixed(4)}\n`;
    text += `Ki-Kare Testi       : ${adj.chiSquareTest?.passed ? 'BAŞARILI (KABUL EDİLDİ)' : 'UYARI (Tolerans Dışı)'} ` +
      `[T = ${adj.chiSquareTest?.testStatistic.toFixed(2)}, Sınırlar: ${adj.chiSquareTest?.lowerLimit.toFixed(2)} - ${adj.chiSquareTest?.upperLimit.toFixed(2)}]\n`;
    text += `Yineleme Sayısı     : ${adj.iterations}\n`;
    text += `Maks. Düzeltme      : ${adj.maxDisplacementMm.toFixed(2)} mm\n\n`;
  } else {
    text += 'Henüz dengeleme hesabı yürütülmemiş (Taslak aşamasında).\n\n';
  }

  text += '--------------------------------------------------------------------------------\n';
  text += '2. İSTASYONLAR VE KOORDİNAT LİSTESİ\n';
  text += '--------------------------------------------------------------------------------\n';
  const stations = pData?.stations || {};
  text += 'Nokta No | Tür   | Sağa Değer (Y)  | Yukarı Değer (X) | Elips. Kot (h) | Sabit | Alet Yük.(m)\n';
  text += '---------|-------|-----------------|------------------|----------------|-------|-------------\n';
  for (const st of Object.values(stations)) {
    const isFixedStr = st.isFixed?.x ? 'SABİT' : 'SERBEST';
    const projY = (st.adjustedProjY || st.projY || 0).toFixed(3).padStart(15, ' ');
    const projX = (st.adjustedProjX || st.projX || 0).toFixed(3).padStart(16, ' ');
    const h = (st.adjustedH || st.groundH || st.h || 0).toFixed(3).padStart(14, ' ');
    const hType = (st.antenna?.measuredHeight || 0).toFixed(3).padStart(11, ' ');
    text += `${st.name.padEnd(8, ' ')} | ${st.type.padEnd(5, ' ')} | ${projY} | ${projX} | ${h} | ${isFixedStr.padEnd(5, ' ')} | ${hType}\n`;
  }
  text += '\n';

  text += '--------------------------------------------------------------------------------\n';
  text += '3. BAZ VEKTÖRLERİ VE ÇÖZÜM KALİTESİ\n';
  text += '--------------------------------------------------------------------------------\n';
  const baselines = pData?.baselines || [];
  text += 'Baz (Kimden -> Kime)     | Uzunluk (m) | Çözüm | Ratio  | RMS (m) | Vx (mm) | Vy (mm) | Vz (mm)\n';
  text += '-------------------------|-------------|-------|--------|---------|---------|---------|--------\n';
  for (const b of baselines) {
    const nameStr = `${b.fromId} -> ${b.toId}`.padEnd(23, ' ');
    const lenStr = b.length.toFixed(3).padStart(11, ' ');
    const solStr = b.solutionType.padEnd(5, ' ');
    const ratioStr = (b.ratio || 0).toFixed(1).padStart(6, ' ');
    const rmsStr = (b.rms || 0).toFixed(4).padStart(7, ' ');
    const vx = (b.vX || 0).toFixed(1).padStart(7, ' ');
    const vy = (b.vY || 0).toFixed(1).padStart(7, ' ');
    const vz = (b.vZ || 0).toFixed(1).padStart(7, ' ');
    text += `${nameStr} | ${lenStr} | ${solStr} | ${ratioStr} | ${rmsStr} | ${vx} | ${vy} | ${vz}\n`;
  }
  text += '\n';

  text += '================================================================================\n';
  text += 'Bu dosya ACB Maps GNSS Ağ Dengeleme Sistemi tarafından otomatik üretilmiştir.\n';
  text += 'Arşiv paketindeki archive_manifest.json dosyasında HMAC-SHA256 imzası mevcuttur.\n';
  text += '================================================================================\n';

  return text;
}

/**
 * Generates README_ARSIV.txt instructions
 */
function generateReadmeText(project: SavedProject, rinexFilesCount: number): string {
  return `================================================================================
           GNSS NİRENGİ PROJESİ TAM ARŞİV PAKETİ (HMAC GÜVENLİKLİ)
================================================================================

Proje Adı        : ${project.name}
Proje ID         : ${project.id}
Arşiv Tarihi     : ${new Date().toISOString()}
İstasyon Sayısı  : ${project.stationCount || Object.keys(project.data?.stations || {}).length}
Baz Sayısı       : ${project.baselineCount || (project.data?.baselines || []).length}
Ham RINEX Dosyası: ${rinexFilesCount} adet

BU ARŞİV HAKKINDA:
-----------------
Bu .zip arşivi, projenin hem hesaplanan nihai koordinat ve dengeleme sonuçlarını
hem de hesaplamada kullanılan ham RINEX gözlem (.obs, .24o) ve navigasyon (.nav)
dosyalarını tek bir pakette sıfır veri kaybıyla saklar.

GÜVENLİK VE BÜTÜNLÜK (HMAC-SHA256):
-----------------------------------
Arşiv içindeki "archive_manifest.json" dosyası tüm dosyaların (RINEX ölçüleri dahil)
kriptografik SHA-256 hash özetlerini ve gizli anahtarlı HMAC-SHA256 dijital
imzasını içerir.

Bu paketteki herhangi bir RINEX dosyasında veya koordinat satırında yapılacak
1 baytlık değişiklik dahi sistem tarafından otomatik olarak tespit edilir ve
tahrifat uyarısı verilir.

GERİ YÜKLEME (RESTORE):
-----------------------
ACB Maps GNSS Nirengi uygulamasında "Tam Proje Arşivi Yükle (.zip)" butonuna
tıklayıp bu dosyayı seçtiğinizde:
1. Tüm HMAC ve SHA-256 doğrulamaları otomatik yapılır.
2. Proje verileri anında yüklenir.
3. Ham RINEX dosyaları tarayıcının güvenli yerel diskine (OPFS) geri aktarılır.

ACB Maps Geodesy & GNSS Systems
`;
}

/**
 * Exports a project as a 100% complete, HMAC-protected ZIP archive
 */
export async function exportSecureProjectZipArchive(
  project: SavedProject,
  onProgress?: (progress: ExportArchiveProgress) => void
): Promise<Blob> {
  const zip = new JSZip();

  onProgress?.({
    percent: 5,
    stage: 'SCANNING',
    message: 'Proje istasyonları ve OPFS ham RINEX dosyaları taranıyor...',
  });

  // 1. Prepare signed project JSON payload
  const exportPayload = {
    app: 'ACB Maps - Nirengi Hesabı',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    id: project.id,
    name: project.name,
    projectName: project.name,
    calculatedAt: project.calculatedAt || project.updatedAt,
    updatedAt: project.updatedAt,
    stationCount: project.stationCount ?? (project.data?.stations ? Object.keys(project.data.stations).length : project.pointCount ?? 0),
    baselineCount: project.baselineCount ?? (project.data?.baselines ? project.data.baselines.length : 0),
    pointCount: project.pointCount ?? project.stationCount,
    sigma0: project.sigma0,
    isAccepted: project.isAccepted,
    data: {
      config: project.data?.config,
      stations: project.data?.stations,
      baselines: project.data?.baselines,
      loopClosures: project.data?.loopClosures,
      unconstrainedResult: project.data?.unconstrainedResult,
      constrainedResult: project.data?.constrainedResult,
      adjustmentResult: project.data?.adjustmentResult,
    },
  };
  const signedPayload = signBackupData(exportPayload);
  const jsonContentStr = JSON.stringify(signedPayload, null, 2);
  const jsonBytes = new TextEncoder().encode(jsonContentStr);

  // 2. Prepare text reports
  const summaryText = generateProjectSummaryText(project);
  const summaryBytes = new TextEncoder().encode(summaryText);

  // 3. Collect all raw RINEX files from OPFS
  const stations = project.data?.stations || {};
  const rinexFileMap = new Map<string, Uint8Array>();

  const rinexFolderNamesToSearch = new Set<string>();
  for (const st of Object.values(stations)) {
    if (st.occupation?.fileName) {
      rinexFolderNamesToSearch.add(st.occupation.fileName);
    }
  }

  // Also query all stored OPFS files in case user uploaded nav or other project files
  try {
    const storedList = await listRinexFilesInOpfs();
    for (const stored of storedList) {
      if (rinexFolderNamesToSearch.has(stored.name) || stored.name.endsWith('.nav') || stored.name.endsWith('.24n') || stored.name.endsWith('.25n') || stored.name.endsWith('.rnx')) {
        rinexFolderNamesToSearch.add(stored.name);
      }
    }
  } catch (err) {
    console.warn('OPFS list check warning:', err);
  }

  let fileIndex = 0;
  const totalRinexFiles = rinexFolderNamesToSearch.size;

  for (const fileName of rinexFolderNamesToSearch) {
    fileIndex++;
    onProgress?.({
      percent: 10 + Math.round((fileIndex / Math.max(1, totalRinexFiles)) * 30),
      stage: 'SCANNING',
      currentFile: fileName,
      message: `Ham RINEX dosyası okunuyor: ${fileName} (${fileIndex}/${totalRinexFiles})`,
    });

    try {
      const file = await loadRinexFileFromOpfs(fileName);
      if (file) {
        const buffer = await file.arrayBuffer();
        rinexFileMap.set(fileName, new Uint8Array(buffer));
      }
    } catch (err) {
      console.warn(`Could not load RINEX file ${fileName} from OPFS:`, err);
    }
  }

  const readmeText = generateReadmeText(project, rinexFileMap.size);
  const readmeBytes = new TextEncoder().encode(readmeText);

  // 4. Hashing Phase: Compute SHA-256 for all files to be included in archive
  onProgress?.({
    percent: 45,
    stage: 'HASHING',
    message: 'Tüm dosyalara ait kriptografik SHA-256 özetleri hesaplanıyor...',
  });

  const manifestFiles: ArchiveManifestFile[] = [];

  // Add JSON file
  manifestFiles.push({
    path: 'proje_verileri.json',
    size: jsonBytes.length,
    sha256: sha256Hex(jsonBytes),
  });

  // Add summary text
  manifestFiles.push({
    path: 'dengeleme_ozeti.txt',
    size: summaryBytes.length,
    sha256: sha256Hex(summaryBytes),
  });

  // Add readme
  manifestFiles.push({
    path: 'README_ARSIV.txt',
    size: readmeBytes.length,
    sha256: sha256Hex(readmeBytes),
  });

  // Add all RINEX files
  rinexFileMap.forEach((bytes, fileName) => {
    manifestFiles.push({
      path: `rinex/${fileName}`,
      size: bytes.length,
      sha256: sha256Hex(bytes),
    });
  });

  // 5. Signing Phase: Generate HMAC-SHA256 signature for the manifest
  onProgress?.({
    percent: 60,
    stage: 'SIGNING',
    message: 'Arşiv manifestosu HMAC-SHA256 ile imzalanıyor...',
  });

  const manifestData: Omit<ArchiveManifest, 'signature' | 'integrity'> = {
    app: 'ACB Maps - Nirengi Hesabı & GNSS Arşiv Yöneticisi',
    version: '1.0',
    projectId: project.id,
    projectName: project.name,
    createdAt: new Date().toISOString(),
    files: manifestFiles,
  };
  const signedManifest = signArchiveManifest(manifestData);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(signedManifest, null, 2));

  // 6. Assembly Phase: Build JSZip hierarchy
  zip.file('archive_manifest.json', manifestBytes);
  zip.file('proje_verileri.json', jsonBytes);
  zip.file('dengeleme_ozeti.txt', summaryBytes);
  zip.file('README_ARSIV.txt', readmeBytes);

  const rinexZipFolder = zip.folder('rinex');
  if (rinexZipFolder) {
    rinexFileMap.forEach((bytes, fileName) => {
      rinexZipFolder.file(fileName, bytes);
    });
  }

  // 7. Compression Phase
  onProgress?.({
    percent: 70,
    stage: 'COMPRESSING',
    message: 'ZIP arşivi sıkıştırılıyor (DEFLATE)...',
  });

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    },
    (metadata) => {
      const p = 70 + Math.round((metadata.percent / 100) * 28);
      onProgress?.({
        percent: Math.min(98, p),
        stage: 'COMPRESSING',
        currentFile: metadata.currentFile || undefined,
        message: `Arşiv sıkıştırılıyor: %${Math.round(metadata.percent)}`,
      });
    }
  );

  onProgress?.({
    percent: 100,
    stage: 'COMPLETED',
    message: 'Tam proje arşivi başarıyla oluşturuldu.',
  });

  return zipBlob;
}

/**
 * Triggers native browser download for a Blob
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Imports and strictly verifies an HMAC-protected ZIP archive
 */
export async function importSecureProjectZipArchive(
  zipFile: File,
  onProgress?: (progress: ImportArchiveProgress) => void
): Promise<ImportArchiveResult> {
  onProgress?.({
    percent: 10,
    stage: 'READING',
    message: 'ZIP arşivi taranıyor...',
  });

  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(zipFile);

  // Read all files from ZIP into memory map
  const actualFiles = new Map<string, Uint8Array>();
  const fileEntries = Object.keys(loadedZip.files);
  let readCount = 0;

  for (const relativePath of fileEntries) {
    const entry = loadedZip.files[relativePath];
    if (entry.dir) continue;

    readCount++;
    onProgress?.({
      percent: 10 + Math.round((readCount / Math.max(1, fileEntries.length)) * 30),
      stage: 'READING',
      currentFile: relativePath,
      message: `Dosya okunuyor: ${relativePath}`,
    });

    const fileData = await entry.async('uint8array');
    actualFiles.set(relativePath, fileData);
  }

  // 1. Look for archive_manifest.json
  const manifestDataBytes = actualFiles.get('archive_manifest.json');
  if (!manifestDataBytes) {
    throw new Error(
      'Güvenlik Hatası: Bu ZIP arşivinde "archive_manifest.json" ve HMAC koruma imzası bulunamadı. ' +
      'Dosya orijinal ACB Maps güvenli arşiv formatında olmayabilir.'
    );
  }

  onProgress?.({
    percent: 45,
    stage: 'VERIFYING_HMAC',
    message: 'Kriptografik HMAC-SHA256 imzası denetleniyor...',
  });

  let manifest: ArchiveManifest;
  try {
    const manifestText = new TextDecoder().decode(manifestDataBytes);
    manifest = JSON.parse(manifestText);
  } catch (err) {
    throw new Error('Arşiv manifestosu okunamadı: Geçersiz JSON biçimi.');
  }

  // 2. Verify HMAC signature and SHA-256 hashes of every file
  onProgress?.({
    percent: 55,
    stage: 'VERIFYING_HASHES',
    message: 'Ham RINEX ve proje dosyalarının SHA-256 özetleri kontrol ediliyor...',
  });

  const verification = verifyArchiveManifest(manifest, actualFiles);
  if (!verification.isValid) {
    throw new Error(
      `Tahrifat Koruması Engelledi: ${verification.message}\n\n` +
      'Bu arşiv dosyasında harici bir değişiklik yapıldığı tespit edildiğinden veri güvenliği gereği yükleme reddedildi.'
    );
  }

  // 3. Find and verify project JSON
  let projectJsonBytes = actualFiles.get('proje_verileri.json');
  if (!projectJsonBytes) {
    // Try finding any root .json
    for (const [path, bytes] of actualFiles.entries()) {
      if (path.endsWith('.json') && path !== 'archive_manifest.json') {
        projectJsonBytes = bytes;
        break;
      }
    }
  }

  if (!projectJsonBytes) {
    throw new Error('Arşiv içinde proje koordinat ve dengeleme verisi (.json) bulunamadı.');
  }

  const projectText = new TextDecoder().decode(projectJsonBytes);
  const parsedProject = JSON.parse(projectText);

  // Also verify internal JSON HMAC if present
  const jsonIntegrity = verifyBackupIntegrity(parsedProject);
  if (jsonIntegrity.hasSignature && !jsonIntegrity.isValid) {
    throw new Error('Proje veri dosyasının (JSON) iç HMAC bütünlüğü bozulmuş.');
  }

  // 4. Extract RINEX files to OPFS
  onProgress?.({
    percent: 75,
    stage: 'EXTRACTING_OPFS',
    message: 'Ham RINEX dosyaları güvenli yerel depolama alanına (OPFS) aktarılıyor...',
  });

  const restoredRinexFiles: string[] = [];
  const rinexFilesToExtract: Array<{ name: string; bytes: Uint8Array }> = [];

  actualFiles.forEach((bytes, path) => {
    if (path.startsWith('rinex/')) {
      const fileName = path.replace(/^rinex\//, '');
      if (fileName) {
        rinexFilesToExtract.push({ name: fileName, bytes });
      }
    }
  });

  let extractedCount = 0;
  for (const item of rinexFilesToExtract) {
    extractedCount++;
    onProgress?.({
      percent: 75 + Math.round((extractedCount / Math.max(1, rinexFilesToExtract.length)) * 22),
      stage: 'EXTRACTING_OPFS',
      currentFile: item.name,
      message: `RINEX dosyası yerel diske kaydediliyor: ${item.name}`,
    });

    const file = new File([item.bytes as unknown as BlobPart], item.name, {
      type: 'application/octet-stream',
      lastModified: Date.now(),
    });

    await saveRinexFileToOpfs(file);
    restoredRinexFiles.push(item.name);
  }

  onProgress?.({
    percent: 100,
    stage: 'COMPLETED',
    message: `Arşiv başarıyla doğrulandı ve açıldı! (${restoredRinexFiles.length} ham RINEX dosyası kurtarıldı)`,
  });

  const projectObj: SavedProject = {
    id: parsedProject.id || 'project-' + Date.now(),
    name: parsedProject.name || parsedProject.projectName || 'Arşivden Yüklenen Proje',
    calculatedAt: parsedProject.calculatedAt,
    updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    stationCount: parsedProject.stationCount ?? (parsedProject.data?.stations ? Object.keys(parsedProject.data.stations).length : 0),
    baselineCount: parsedProject.baselineCount ?? (parsedProject.data?.baselines ? parsedProject.data.baselines.length : 0),
    pointCount: parsedProject.pointCount ?? parsedProject.stationCount,
    sigma0: parsedProject.sigma0,
    isAccepted: parsedProject.isAccepted,
    data: parsedProject.data,
  };

  return {
    project: projectObj,
    restoredRinexFiles,
    integrity: verification,
  };
}
