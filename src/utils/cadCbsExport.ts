/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CAD & CBS Dışa Aktarım Motoru (DXF, KML, GeoJSON) - Faz 5
 * Conforms to AutoCAD, Netcad, Google Earth, and QGIS specifications.
 * Rigorously exports stations, baselines, and scaled 2D error ellipses.
 */

import { JobConfig, AdjustmentResult, Station, BaselineVector } from '../types/gnss';

/**
 * Generates an AutoCAD / Netcad compatible ASCII DXF file (R12/R2000).
 * Layers:
 * - NOKTALAR (Point markers)
 * - NOKTA_ADLARI (Text labels for names)
 * - NOKTA_KOTLARI (Text labels for ellipsoidal heights)
 * - BAZLAR (Baseline connection lines)
 * - HATA_ELIPSLERI (2D error ellipses at specified scale factor, e.g. 1000x or 500x)
 */
export function exportNetworkToDxf(
  config: JobConfig,
  stations: Record<string, Station>,
  baselines: BaselineVector[],
  adjustmentResult: AdjustmentResult | null,
  ellipseScale: number = 1000 // default 1000x magnification so mm errors are visible on meter scale
): void {
  const stationList = Object.values(stations);
  if (stationList.length === 0) return;

  let dxf = '';

  // HEADER SECTION
  dxf += '0\nSECTION\n2\nHEADER\n';
  dxf += '9\n$ACADVER\n1\nAC1009\n'; // AutoCAD R12 standard (broadest CAD/Netcad compatibility)
  dxf += '0\nENDSEC\n';

  // TABLES SECTION (Layers)
  dxf += '0\nSECTION\n2\nTABLES\n';
  dxf += '0\nTABLE\n2\nLAYER\n';

  const layers = [
    { name: 'NOKTALAR', color: 7 }, // White/Black
    { name: 'NOKTA_ADLARI', color: 3 }, // Green
    { name: 'NOKTA_KOTLARI', color: 4 }, // Cyan
    { name: 'BAZLAR', color: 5 }, // Blue
    { name: 'HATA_ELIPSLERI', color: 1 }, // Red
  ];

  for (const lyr of layers) {
    dxf += '0\nLAYER\n';
    dxf += `2\n${lyr.name}\n`;
    dxf += '70\n0\n';
    dxf += `62\n${lyr.color}\n`;
    dxf += '6\nCONTINUOUS\n';
  }
  dxf += '0\nENDTAB\n';
  dxf += '0\nENDSEC\n';

  // ENTITIES SECTION
  dxf += '0\nSECTION\n2\nENTITIES\n';

  // 1. Baselines (BAZLAR)
  const activeBaselines = baselines.filter((b) => !b.excluded);
  for (const b of activeBaselines) {
    const stFrom = stations[b.fromId];
    const stTo = stations[b.toId];
    if (!stFrom || !stTo) continue;

    const x1 = (stFrom.adjustedProjY ?? stFrom.projY).toFixed(4); // Netcad/CAD X = Sağa (Y)
    const y1 = (stFrom.adjustedProjX ?? stFrom.projX).toFixed(4); // Netcad/CAD Y = Yukarı (X)
    const z1 = (stFrom.adjustedH ?? stFrom.h).toFixed(4);

    const x2 = (stTo.adjustedProjY ?? stTo.projY).toFixed(4);
    const y2 = (stTo.adjustedProjX ?? stTo.projX).toFixed(4);
    const z2 = (stTo.adjustedH ?? stTo.h).toFixed(4);

    dxf += '0\nLINE\n';
    dxf += '8\nBAZLAR\n';
    dxf += `10\n${x1}\n20\n${y1}\n30\n${z1}\n`;
    dxf += `11\n${x2}\n21\n${y2}\n31\n${z2}\n`;
  }

  // 2. Stations & Labels (NOKTALAR, NOKTA_ADLARI, NOKTA_KOTLARI)
  for (const st of stationList) {
    const easting = st.adjustedProjY ?? st.projY;
    const northing = st.adjustedProjX ?? st.projX;
    const height = st.adjustedH ?? st.h;

    const eStr = easting.toFixed(4);
    const nStr = northing.toFixed(4);
    const hStr = height.toFixed(4);

    // Point Entity
    dxf += '0\nPOINT\n';
    dxf += '8\nNOKTALAR\n';
    dxf += `10\n${eStr}\n20\n${nStr}\n30\n${hStr}\n`;

    // Point Name Label
    const textHeight = 1.5;
    dxf += '0\nTEXT\n';
    dxf += '8\nNOKTA_ADLARI\n';
    dxf += `10\n${(easting + 1.2).toFixed(4)}\n20\n${(northing + 1.2).toFixed(4)}\n30\n${hStr}\n`;
    dxf += `40\n${textHeight}\n`;
    dxf += `1\n${st.name}\n`;

    // Height Label
    dxf += '0\nTEXT\n';
    dxf += '8\nNOKTA_KOTLARI\n';
    dxf += `10\n${(easting + 1.2).toFixed(4)}\n20\n${(northing - 1.5).toFixed(4)}\n30\n${hStr}\n`;
    dxf += `40\n${textHeight * 0.8}\n`;
    dxf += `1\nH=${height.toFixed(3)}m\n`;

    // 3. Error Ellipse (HATA_ELIPSLERI)
    const a_mm = st.semiMajor ?? 0;
    const b_mm = st.semiMinor ?? 0;
    const gon = st.ellipseAzimuth ?? 0;

    if (a_mm > 0.05 && b_mm > 0.05) {
      // Convert mm to meters with scale magnification factor
      const a_m = (a_mm / 1000.0) * ellipseScale;
      const b_m = (b_mm / 1000.0) * ellipseScale;
      // Convert azimuth Gon to CAD rotation radians (0 Gon = North = +Y, clockwise)
      // CAD angle is counter-clockwise from East (+X).
      // Angle in degrees = 90 - (gon * 360 / 400)
      const azDeg = (gon * 360.0) / 400.0;
      const cadAngleRad = ((90.0 - azDeg) * Math.PI) / 180.0;

      // Draw ellipse as 32-segment closed polyline
      const segments = 32;
      dxf += '0\nPOLYLINE\n';
      dxf += '8\nHATA_ELIPSLERI\n';
      dxf += '66\n1\n'; // entities follow
      dxf += '70\n1\n'; // closed polyline

      for (let i = 0; i < segments; i++) {
        const t = (2 * Math.PI * i) / segments;
        const x_local = a_m * Math.cos(t);
        const y_local = b_m * Math.sin(t);

        // Rotate by CAD angle
        const x_rot = x_local * Math.cos(cadAngleRad) - y_local * Math.sin(cadAngleRad);
        const y_rot = x_local * Math.sin(cadAngleRad) + y_local * Math.cos(cadAngleRad);

        const vX = (easting + x_rot).toFixed(4);
        const vY = (northing + y_rot).toFixed(4);

        dxf += '0\nVERTEX\n';
        dxf += '8\nHATA_ELIPSLERI\n';
        dxf += `10\n${vX}\n20\n${vY}\n30\n${hStr}\n`;
      }
      dxf += '0\nSEQEND\n';
    }
  }

  dxf += '0\nENDSEC\n';
  dxf += '0\nEOF\n';

  // Trigger file download
  const blob = new Blob([dxf], { type: 'application/dxf;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = `${config.projectName.replace(/\s+/g, '_')}_Ag_Dengeleme_Netcad.dxf`;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates Google Earth KML with 3D Placemarks and Baseline tracks.
 */
export function exportNetworkToKml(
  config: JobConfig,
  stations: Record<string, Station>,
  baselines: BaselineVector[],
  adjustmentResult: AdjustmentResult | null
): void {
  const stationList = Object.values(stations);
  if (stationList.length === 0) return;

  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  kml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
  kml += `  <Document>\n`;
  kml += `    <name>${escapeXml(config.projectName)} - GNSS Ağ Dengeleme</name>\n`;
  kml += `    <description>ITRF96 / TUREF Dayalı GNSS Ağ Dengelemesi ve Hata Analizi</description>\n\n`;

  // Styles
  kml += `    <Style id="corsPoint">\n`;
  kml += `      <IconStyle>\n`;
  kml += `        <color>ff0000ff</color>\n`; // Red
  kml += `        <scale>1.2</scale>\n`;
  kml += `        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/triangle.png</href></Icon>\n`;
  kml += `      </IconStyle>\n`;
  kml += `    </Style>\n`;

  kml += `    <Style id="roverPoint">\n`;
  kml += `      <IconStyle>\n`;
  kml += `        <color>ffffaa00</color>\n`; // Light Blue
  kml += `        <scale>1.1</scale>\n`;
  kml += `        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>\n`;
  kml += `      </IconStyle>\n`;
  kml += `    </Style>\n`;

  kml += `    <Style id="baselineLine">\n`;
  kml += `      <LineStyle>\n`;
  kml += `        <color>ff00ff00</color>\n`; // Green
  kml += `        <width>2.5</width>\n`;
  kml += `      </LineStyle>\n`;
  kml += `    </Style>\n\n`;

  // Folders: Stations
  kml += `    <Folder>\n`;
  kml += `      <name>Nirengi Noktaları (${stationList.length})</name>\n`;

  for (const st of stationList) {
    const lat = st.adjustedLat ?? st.lat;
    const lon = st.adjustedLon ?? st.lon;
    const h = st.adjustedH ?? st.h;
    const isCors = st.type === 'CORS' || (st.isFixed.x && st.isFixed.y && st.isFixed.z);

    const a = (st.semiMajor ?? 0).toFixed(1);
    const b = (st.semiMinor ?? 0).toFixed(1);
    const theta = (st.ellipseAzimuth ?? 0).toFixed(2);
    const sigH = (st.sigmaH ?? 0).toFixed(1);

    kml += `      <Placemark>\n`;
    kml += `        <name>${escapeXml(st.name)}</name>\n`;
    kml += `        <styleUrl>${isCors ? '#corsPoint' : '#roverPoint'}</styleUrl>\n`;
    kml += `        <description><![CDATA[\n`;
    kml += `          <h3>${escapeXml(st.name)} (${isCors ? 'CORS Sabit İstasyon' : 'Dengelenecek Rover Nokta'})</h3>\n`;
    kml += `          <p><strong>Enlem:</strong> ${lat.toFixed(8)}&deg;</p>\n`;
    kml += `          <p><strong>Boylam:</strong> ${lon.toFixed(8)}&deg;</p>\n`;
    kml += `          <p><strong>Elipsoidal Yükseklik:</strong> ${h.toFixed(3)} m</p>\n`;
    kml += `          <p><strong>TM Sağa (Y):</strong> ${(st.adjustedProjY ?? st.projY).toFixed(3)} m</p>\n`;
    kml += `          <p><strong>TM Yukarı (X):</strong> ${(st.adjustedProjX ?? st.projX).toFixed(3)} m</p>\n`;
    kml += `          <hr/>\n`;
    kml += `          <p><strong>%95 Hata Elipsi:</strong> a=${a} mm, b=${b} mm</p>\n`;
    kml += `          <p><strong>Azimut Açısı:</strong> ${theta} Gon</p>\n`;
    kml += `          <p><strong>Düşey Doğruluk (σ_H):</strong> ${sigH} mm</p>\n`;
    kml += `        ]]></description>\n`;
    kml += `        <Point>\n`;
    kml += `          <coordinates>${lon.toFixed(8)},${lat.toFixed(8)},${h.toFixed(3)}</coordinates>\n`;
    kml += `        </Point>\n`;
    kml += `      </Placemark>\n`;
  }
  kml += `    </Folder>\n\n`;

  // Folders: Baselines
  const activeBaselines = baselines.filter((b) => !b.excluded);
  kml += `    <Folder>\n`;
  kml += `      <name>Çözülmüş Baz Vektörleri (${activeBaselines.length})</name>\n`;

  for (const b of activeBaselines) {
    const stFrom = stations[b.fromId];
    const stTo = stations[b.toId];
    if (!stFrom || !stTo) continue;

    const lat1 = stFrom.adjustedLat ?? stFrom.lat;
    const lon1 = stFrom.adjustedLon ?? stFrom.lon;
    const h1 = stFrom.adjustedH ?? stFrom.h;

    const lat2 = stTo.adjustedLat ?? stTo.lat;
    const lon2 = stTo.adjustedLon ?? stTo.lon;
    const h2 = stTo.adjustedH ?? stTo.h;

    kml += `      <Placemark>\n`;
    kml += `        <name>${escapeXml(b.id)} (${escapeXml(b.fromId)} - ${escapeXml(b.toId)})</name>\n`;
    kml += `        <styleUrl>#baselineLine</styleUrl>\n`;
    kml += `        <description><![CDATA[\n`;
    kml += `          <h4>Baz: ${escapeXml(b.fromId)} &rarr; ${escapeXml(b.toId)}</h4>\n`;
    kml += `          <p><strong>Uzunluk:</strong> ${b.length.toFixed(3)} m</p>\n`;
    kml += `          <p><strong>ΔX:</strong> ${b.dX.toFixed(4)} m</p>\n`;
    kml += `          <p><strong>ΔY:</strong> ${b.dY.toFixed(4)} m</p>\n`;
    kml += `          <p><strong>ΔZ:</strong> ${b.dZ.toFixed(4)} m</p>\n`;
    kml += `          <p><strong>Çözüm Tipi:</strong> ${b.solutionType}</p>\n`;
    if (typeof b.spatialV === 'number') {
      kml += `          <p><strong>Düzeltme Kalıntısı (v_3D):</strong> ${b.spatialV.toFixed(1)} mm</p>\n`;
      kml += `          <p><strong>Baarda w-Skoru:</strong> ${(b.wTest ?? 0).toFixed(2)}</p>\n`;
    }
    kml += `        ]]></description>\n`;
    kml += `        <LineString>\n`;
    kml += `          <altitudeMode>clampToGround</altitudeMode>\n`;
    kml += `          <coordinates>\n`;
    kml += `            ${lon1.toFixed(8)},${lat1.toFixed(8)},${h1.toFixed(3)}\n`;
    kml += `            ${lon2.toFixed(8)},${lat2.toFixed(8)},${h2.toFixed(3)}\n`;
    kml += `          </coordinates>\n`;
    kml += `        </LineString>\n`;
    kml += `      </Placemark>\n`;
  }
  kml += `    </Folder>\n`;

  kml += `  </Document>\n`;
  kml += `</kml>\n`;

  // Trigger file download
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = `${config.projectName.replace(/\s+/g, '_')}_Google_Earth.kml`;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates standard GeoJSON for QGIS, ArcGIS and WebGIS.
 */
export function exportNetworkToGeoJson(
  config: JobConfig,
  stations: Record<string, Station>,
  baselines: BaselineVector[],
  adjustmentResult: AdjustmentResult | null
): void {
  const stationList = Object.values(stations);
  const features: any[] = [];

  // Point features
  for (const st of stationList) {
    const lat = st.adjustedLat ?? st.lat;
    const lon = st.adjustedLon ?? st.lon;
    const h = st.adjustedH ?? st.h;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lon, lat, h],
      },
      properties: {
        id: st.id,
        name: st.name,
        type: st.type,
        isFixed: st.isFixed.x && st.isFixed.y && st.isFixed.z,
        adjustedX: st.adjustedX ?? st.x,
        adjustedY: st.adjustedY ?? st.y,
        adjustedZ: st.adjustedZ ?? st.z,
        tmSağaY: st.adjustedProjY ?? st.projY,
        tmYukarıX: st.adjustedProjX ?? st.projX,
        height: h,
        semiMajorMm: st.semiMajor ?? 0,
        semiMinorMm: st.semiMinor ?? 0,
        azimuthGon: st.ellipseAzimuth ?? 0,
        sigmaHMm: st.sigmaH ?? 0,
        sigmaEastMm: st.sigmaEast ?? 0,
        sigmaNorthMm: st.sigmaNorth ?? 0,
        sigmaUpMm: st.sigmaUp ?? 0,
      },
    });
  }

  // Line features
  const activeBaselines = baselines.filter((b) => !b.excluded);
  for (const b of activeBaselines) {
    const stFrom = stations[b.fromId];
    const stTo = stations[b.toId];
    if (!stFrom || !stTo) continue;

    const lat1 = stFrom.adjustedLat ?? stFrom.lat;
    const lon1 = stFrom.adjustedLon ?? stFrom.lon;
    const h1 = stFrom.adjustedH ?? stFrom.h;

    const lat2 = stTo.adjustedLat ?? stTo.lat;
    const lon2 = stTo.adjustedLon ?? stTo.lon;
    const h2 = stTo.adjustedH ?? stTo.h;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon1, lat1, h1],
          [lon2, lat2, h2],
        ],
      },
      properties: {
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        lengthM: b.length,
        dX: b.dX,
        dY: b.dY,
        dZ: b.dZ,
        solutionType: b.solutionType,
        vX_mm: b.vX ?? 0,
        vY_mm: b.vY ?? 0,
        vZ_mm: b.vZ ?? 0,
        v3D_mm: b.spatialV ?? 0,
        baardaW: b.wTest ?? 0,
        redundancyR: b.redundancyNumber ?? 1.0,
        isOutlier: b.isOutlier ?? false,
      },
    });
  }

  const geoJson = {
    type: 'FeatureCollection',
    name: `${config.projectName}_GNSS_Ag`,
    crs: {
      type: 'name',
      properties: {
        name: 'urn:ogc:def:crs:OGC:1.3:CRS84',
      },
    },
    features,
  };

  const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: 'application/geo+json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = `${config.projectName.replace(/\s+/g, '_')}_GNSS_QGIS.geojson`;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates a Netcad Point File (.NCN / .XYZ).
 * Standard Netcad column format: PNO  Y(Sağa)  X(Yukarı)  Z(Kot)
 */
export function exportNetworkToNetcadNcn(
  config: JobConfig,
  stations: Record<string, Station>,
  adjustmentResult: AdjustmentResult | null
): void {
  const stationList = Object.values(adjustmentResult?.stations || stations);
  if (stationList.length === 0) return;

  let ncn = `* Netcad NCN Nokta Dosyasi - TUREF / ITRF96 (DOM: ${config.dom} Derece)\n`;
  ncn += `* Proje: ${config.projectName}\n`;
  ncn += `* Tarih: ${new Date().toLocaleDateString('tr-TR')}\n`;
  ncn += `* PNO           Y(Saga)         X(Yukari)       Z(Kot)\n`;

  for (const st of stationList) {
    const pno = st.name.padEnd(14, ' ');
    const yStr = (st.adjustedProjY ?? st.projY).toFixed(3).padStart(15, ' ');
    const xStr = (st.adjustedProjX ?? st.projX).toFixed(3).padStart(15, ' ');
    const zStr = (st.adjustedH ?? st.h).toFixed(3).padStart(12, ' ');
    ncn += `${pno} ${yStr} ${xStr} ${zStr}\n`;
  }

  const blob = new Blob([ncn], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = `${config.projectName.replace(/\s+/g, '_')}_Netcad.ncn`;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates standard Geodetic Coordinates CSV with UTF-8 BOM.
 */
export function exportNetworkToCsv(
  config: JobConfig,
  stations: Record<string, Station>,
  adjustmentResult: AdjustmentResult | null
): void {
  const stationList = Object.values(adjustmentResult?.stations || stations);
  if (stationList.length === 0) return;

  const headers = [
    'Nokta Adı',
    'Tip',
    'Durum',
    'TM Sağa Y (m)',
    'TM Yukarı X (m)',
    'Elipsoit Yüksekliği h (m)',
    'Enlem (Derece)',
    'Boylam (Derece)',
    'ECEF X (m)',
    'ECEF Y (m)',
    'ECEF Z (m)',
    'sigma_E (mm)',
    'sigma_N (mm)',
    'sigma_Up (mm)',
    'Hata Elipsi a (mm)',
    'Hata Elipsi b (mm)',
    'Azimut (Gon)',
    'sigma_H (mm)',
  ];

  const rows = stationList.map((st) => {
    const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
    return [
      `"${st.name}"`,
      `"${st.type}"`,
      `"${isFixed ? 'CORS SABİT' : 'DENGELENDİ'}"`,
      (st.adjustedProjY ?? st.projY).toFixed(4),
      (st.adjustedProjX ?? st.projX).toFixed(4),
      (st.adjustedH ?? st.h).toFixed(4),
      (st.adjustedLat ?? st.lat).toFixed(8),
      (st.adjustedLon ?? st.lon).toFixed(8),
      (st.adjustedX ?? st.x).toFixed(4),
      (st.adjustedY ?? st.y).toFixed(4),
      (st.adjustedZ ?? st.z).toFixed(4),
      (st.sigmaEast ?? st.sigmaX ?? 0).toFixed(1),
      (st.sigmaNorth ?? st.sigmaY ?? 0).toFixed(1),
      (st.sigmaUp ?? st.sigmaZ ?? 0).toFixed(1),
      isFixed ? '0.0' : (st.semiMajor ?? 0).toFixed(1),
      isFixed ? '0.0' : (st.semiMinor ?? 0).toFixed(1),
      isFixed ? '0.0' : (st.ellipseAzimuth ?? 0).toFixed(2),
      (st.sigmaH ?? 0).toFixed(1),
    ].join(';');
  });

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = `${config.projectName.replace(/\s+/g, '_')}_Nokta_Koordinatlari.csv`;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates Netcad / Geodetic Baseline (.BAZ) Vector File.
 */
export function exportNetworkToNetcadBaz(
  config: JobConfig,
  baselines: BaselineVector[],
  adjustmentResult: AdjustmentResult | null
): void {
  const bList = adjustmentResult?.baselines || baselines.filter((b) => !b.excluded);
  if (bList.length === 0) return;

  let baz = `* Netcad / Geodetic BAZ Dosyasi - TUREF / ITRF96\n`;
  baz += `* Proje: ${config.projectName}\n`;
  baz += `* BAZ_ID      DURAK_1       DURAK_2       UZUNLUK(m)      dX(m)           dY(m)           dZ(m)           v_3D(mm)   w_TEST\n`;

  for (const b of bList) {
    const id = b.id.padEnd(12, ' ');
    const from = b.fromId.padEnd(13, ' ');
    const to = b.toId.padEnd(13, ' ');
    const len = b.length.toFixed(4).padStart(14, ' ');
    const dx = b.dX.toFixed(4).padStart(15, ' ');
    const dy = b.dY.toFixed(4).padStart(15, ' ');
    const dz = b.dZ.toFixed(4).padStart(15, ' ');
    const v3d = (b.spatialV ?? 0).toFixed(1).padStart(10, ' ');
    const w = (b.wTest ?? 0).toFixed(2).padStart(8, ' ');

    baz += `${id} ${from} ${to} ${len} ${dx} ${dy} ${dz} ${v3d} ${w}\n`;
  }

  const blob = new Blob([baz], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = `${config.projectName.replace(/\s+/g, '_')}_Baz_Vektorleri.baz`;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
