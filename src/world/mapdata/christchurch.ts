import type { Pt } from '../mapsource';
import { type Author, mark, type RiverLine } from './helpers';

// ── Central grid ──────────────────────────────────────────────────────────────────────────────
// North–south streets (x) and east–west streets (z) inside the four avenues.
export const X = { deans: -740, park: -420, montreal: -270, durham: -171, colombo: 0, manchester: 150, madras: 270, barbadoes: 390, fitz: 530 };
export const Z = {
  bealey: -5005,
  salisbury: -4900,
  kilmore: -4795,
  chester: -4662,
  armagh: -4530,
  gloucester: -4415,
  worcester: -4300,
  hereford: -4150,
  cashel: -4040,
  lichfield: -3925,
  tuam: -3815,
  stAsaph: -3705,
  moorhouse: -3600,
};
/** ChristChurch Cathedral: the middle of the paved Square, just east of the Colombo Street axis. */
export const CATHEDRAL: Pt = [48, Z.worcester];
const CH = 'christchurch' as const;

export function buildChristchurch(a: Author): RiverLine {
  const b = a.b;

  // ── Ōtākaro / Avon: in from Fendalton, down through Hagley Park, past the hospital, north along the
  // terraces, east between Victoria Square and the Town Hall, then out through Richmond to the estuary.
  const avon = a.river(
    'Avon River',
    [
      [-2150, -5330],
      [-1600, -5200],
      [-1100, -5135],
      [-720, -5120],
      [-600, -5030],
      [-566, -4930],
      [-548, -4800],
      [-545, -4500],
      [-550, -4200],
      [-545, -4060],
      [-515, -3985],
      [-460, -3957],
      [-400, -3955],
      [-270, -3955],
      [-215, -3958],
      [-168, -3985],
      [-149, -4030],
      [-147, -4080],
      [-147, -4300],
      [-147, -4560],
      [-143, -4630],
      [-112, -4668],
      [-50, -4672],
      [150, -4672],
      [400, -4672],
      [530, -4674],
      [700, -4720],
      [900, -4800],
      [1150, -4830],
      [1400, -4760],
      [1650, -4700],
      [1900, -4640],
      [2050, -4540],
      [2090, -4420],
      [2130, -4250],
      [2200, -4080],
      [2330, -3950],
    ],
    14,
  );

  // ── The four avenues (Harper Avenue closes the north-west corner around Hagley Park).
  b.road('Bealey Avenue', 'arterial', [[X.park, Z.bealey], [X.fitz, Z.bealey]]);
  a.road('Fitzgerald Avenue', 'arterial', [[X.fitz, Z.bealey], [X.fitz, Z.moorhouse]]);
  b.road('Moorhouse Avenue', 'arterial', [[X.fitz, Z.moorhouse], [X.deans, Z.moorhouse]]);
  b.road('Deans Avenue', 'arterial', [[X.deans, Z.moorhouse], [X.deans, -4850]]);
  a.road('Harper Avenue', 'arterial', [[X.deans, -4850], [X.park, Z.bealey]], { bridgeName: 'Carlton Mill Bridge' });

  // ── North–south streets. Montreal (north) / Durham (south) and Madras (north) / Barbadoes (south) are one-way pairs.
  b.road('Park Terrace', 'street', [[X.park, Z.bealey], [X.park, Z.armagh]]);
  b.road('Rolleston Avenue', 'street', [[X.park, Z.armagh], [X.park, -3980]]);
  b.road('Hagley Avenue', 'street', [[X.park, -3932], [X.park, Z.moorhouse]]);
  a.road('Montreal Street', 'street', [[X.montreal, Z.moorhouse], [X.montreal, Z.bealey]], { oneway: true });
  b.road('Durham Street North', 'street', [[X.durham, Z.bealey], [X.durham, Z.armagh]], { oneway: true });
  a.road('Durham Street South', 'street', [[X.durham, Z.cashel], [X.durham, Z.moorhouse]], { oneway: true });
  a.road('Colombo Street', 'street', [[X.colombo, Z.bealey], [X.colombo, -4380]]);
  b.road('Colombo Street', 'street', [[X.colombo, -4220], [X.colombo, Z.moorhouse]]);
  a.road('Manchester Street', 'street', [[X.manchester, Z.bealey], [X.manchester, Z.moorhouse]]);
  a.road('Madras Street', 'street', [[X.madras, Z.moorhouse], [X.madras, Z.bealey]], { oneway: true });
  a.road('Barbadoes Street', 'street', [[X.barbadoes, Z.bealey], [X.barbadoes, Z.moorhouse]], { oneway: true });

  // ── East–west streets. Salisbury (east) / Kilmore (west) and Lichfield (east) / St Asaph (west) are one-way pairs.
  const east = 1000; // the Linwood end of the streets that carry on past Fitzgerald Avenue
  b.road('Salisbury Street', 'street', [[X.park, Z.salisbury], [X.fitz, Z.salisbury]], { oneway: true });
  b.road('Kilmore Street', 'street', [[X.fitz, Z.kilmore], [X.park, Z.kilmore]], { oneway: true });
  b.road('Chester Street West', 'street', [[X.park, Z.chester], [X.durham, Z.chester]]);
  a.road('Armagh Street', 'street', [[X.park, Z.armagh], [east, Z.armagh]]);
  a.road('Gloucester Street', 'street', [[X.park, Z.gloucester], [east, Z.gloucester]]);
  a.road('Worcester Boulevard', 'street', [[X.park, Z.worcester], [-123, Z.worcester]], { bridgeName: 'Worcester Street Bridge' });
  b.road('Worcester Street', 'street', [[-123, Z.worcester], [-80, Z.worcester]]);
  b.road('Worcester Street', 'street', [[130, Z.worcester], [east, Z.worcester]]);
  a.road('Hereford Street', 'street', [[X.park, Z.hereford], [east, Z.hereford]]);
  b.road('Cashel Street', 'street', [[X.park, Z.cashel], [X.durham, Z.cashel]]);
  a.road('Cashel Street', 'pedestrian', [[X.durham, Z.cashel], [-123, Z.cashel]], { bridgeName: 'Bridge of Remembrance', width: 9 });
  b.road('City Mall', 'pedestrian', [[-123, Z.cashel], [73, Z.cashel]], { width: 14 });
  b.road('Cashel Street', 'street', [[73, Z.cashel], [east, Z.cashel]]);
  b.road('Lichfield Street', 'street', [[X.durham, Z.lichfield], [X.fitz, Z.lichfield]], { oneway: true });
  b.road('Tuam Street', 'street', [[X.park, Z.tuam], [880, Z.tuam]]);
  b.road('St Asaph Street', 'street', [[X.fitz, Z.stAsaph], [X.park, Z.stAsaph]], { oneway: true });

  // ── Diagonals: High Street (its top end is part of the mall), Victoria Street, New Regent Street.
  b.road('City Mall', 'pedestrian', [[X.colombo, Z.hereford], [73, Z.cashel]], { width: 12 });
  b.road('High Street', 'street', [[73, Z.cashel], [X.manchester, Z.lichfield], [X.madras, Z.tuam]]);
  b.road('Ferry Road', 'arterial', [[X.madras, Z.tuam], [X.barbadoes, Z.stAsaph], [X.fitz, -3655]], { lanes: 1, width: 11 });
  b.road('Victoria Street', 'street', [[X.durham, Z.kilmore], [-300, Z.bealey]]);
  b.road('New Regent Street', 'lane', [[72, Z.armagh], [72, Z.gloucester]], { footpaths: true, speed: 20 });

  // ── Cathedral Square: paved; Colombo and Worcester Streets stop at its edge. A cross of paving in front of the
  // cathedral, and a loop round the back of it.
  const [cx, cz] = CATHEDRAL;
  b.road('Cathedral Square', 'pedestrian', [[X.colombo, -4380], [X.colombo, -4220]], { width: 16 });
  b.road('Cathedral Square', 'pedestrian', [[-80, cz], [X.colombo, cz]], { width: 16 });
  b.road('Cathedral Square', 'pedestrian', [[X.colombo, cz - 54], [cx + 64, cz - 54], [cx + 64, cz + 54], [X.colombo, cz + 54]], { width: 10 });
  b.road('Cathedral Square', 'pedestrian', [[cx + 64, cz], [130, cz]], { width: 10 });

  // ── The terraces, threaded through the bridge ends. Cambridge Terrace carries the southbound one-way between
  // Durham Street North and Durham Street South, as it really does.
  a.terrace('Cambridge Terrace', avon, 1, [X.park, -3980], [X.durham, -4016], 24);
  a.terrace('Cambridge Terrace', avon, 1, [X.durham, Z.cashel], [X.durham, Z.armagh], 24, 'street', { oneway: true }, true);
  a.terrace('Oxford Terrace', avon, -1, [X.park, -3932], [-123, Z.armagh], 24);
  a.terrace('Oxford Terrace', avon, -1, [X.colombo, -4648], [X.fitz, -4650], 24);
  a.terrace('Cambridge Terrace', avon, 1, [X.colombo, -4696], [X.fitz, -4698], 24);

  // ── Hagley Park and the roads through and round it.
  b.road('Riccarton Avenue', 'arterial', [[X.park, Z.stAsaph], [X.deans, -3900]], { lanes: 1, width: 11 });

  // ── Heritage tram loop (opened February 1995): Square – Worcester St – Worcester Blvd – Rolleston Ave –
  // Armagh St – New Regent St – and back along Worcester St past the north side of the cathedral.
  const tram: Pt[] = [];
  const corner = (p: Pt, from: Pt, to: Pt, r = 11) => {
    // Two points either side of a street corner so the fitted curve turns tightly.
    const d0 = Math.hypot(from[0] - p[0], from[1] - p[1]);
    const d1 = Math.hypot(to[0] - p[0], to[1] - p[1]);
    for (const k of [r * 3, r]) tram.push([p[0] + ((from[0] - p[0]) / d0) * k, p[1] + ((from[1] - p[1]) / d0) * k]);
    for (const k of [r, r * 3]) tram.push([p[0] + ((to[0] - p[0]) / d1) * k, p[1] + ((to[1] - p[1]) / d1) * k]);
  };
  const stops: Pt[] = [
    [-46, cz], // Cathedral Square stop
    [X.park, cz], // Worcester Blvd / Rolleston Ave (the museum)
    [X.park, Z.armagh],
    [72, Z.armagh],
    [72, Z.gloucester],
    [X.manchester, Z.gloucester],
    [X.manchester, cz],
  ];
  tram.push(stops[0]);
  for (let i = 1; i < stops.length; i++) corner(stops[i], stops[i - 1], stops[(i + 1) % stops.length] ?? stops[0]);
  // Back into the Square from the east, round the north side of the cathedral, to the stop.
  tram.pop();
  tram.pop();
  tram.push([138, cz], [126, cz - 4], [cx + 60, cz - 44], [cx + 30, cz - 54], [cx, cz - 54], [18, cz - 46], [4, cz - 14], [-12, cz], [-46, cz]);
  b.rail('Christchurch Tramway', tram, 'tram');

  // ── Central landmarks.
  mark(a, 'cathedral-square', 'Cathedral Square', CATHEDRAL, [X.colombo, cz]);
  mark(a, 'chch-cathedral', 'ChristChurch Cathedral', CATHEDRAL, [X.colombo, cz]);
  mark(a, 'tram-stop', 'Cathedral Square Tram Stop', [-46, cz + 6.5], [-46, cz]);
  mark(a, 'arts-centre', 'The Arts Centre', [-345, -4225], [-345, Z.worcester]);
  mark(a, 'canterbury-museum', 'Canterbury Museum', [-472, cz], [X.park, cz]);
  mark(a, 'bridge-of-remembrance', 'Bridge of Remembrance', [-147, Z.cashel], [-100, Z.cashel]);
  mark(a, 'victoria-square', 'Victoria Square', [-72, -4600], [-72, Z.armagh]);
  mark(a, 'town-hall', 'Christchurch Town Hall', [-80, -4733], [-80, -4672]);
  mark(a, 'antigua-boatsheds', 'Antigua Boat Sheds', [-458, -3981], [-448, -3961]);
  mark(a, 'chch-hospital', 'Christchurch Hospital', [-510, -3890], [-562, -3792]);
  mark(a, 'chch-police', 'Central Police Station', [-220, -4095], [-220, Z.hereford]);
  mark(a, 'old-railway-station', 'Old Railway Station', [72, -3538], [72, Z.moorhouse]);

  // ── Central places.
  a.place('cathedral-square', 'Cathedral Square', [6, -4215], [0, -4215], CH, ['mission']);
  a.place('arts-centre', 'The Arts Centre', [-345, -4291], [-345, Z.worcester], CH, ['mission']);
  a.place('antigua-boatsheds', 'Antigua Boat Sheds', [-429, -3992], [X.park, -3992], CH, ['mission']);
  a.place('chch-hospital', 'Christchurch Hospital', [-561, -3803], [-566, -3794], CH, ['hospital']);
  a.place('chch-police', 'Central Police Station', [-220, -4141], [-220, Z.hereford], CH, ['police']);
  a.place('chch-gunshop', 'Southern Cross Sports & Outdoors', [9, -3972], [0, -3972], CH, ['gunshop']);
  a.place('four-aves-start', 'Moorhouse & Deans', [X.deans + 16, Z.moorhouse - 9], [X.deans + 16, Z.moorhouse], CH, ['mission']);

  // ── Central districts.
  a.poly('hagley-park', 'Hagley Park', CH, 'park', [[X.deans + 8, -4846], [X.park - 6, Z.bealey + 8], [X.park - 6, Z.moorhouse - 8], [X.deans + 8, Z.moorhouse - 8]], 8);
  a.rect('cbd', 'Central City', CH, 'cbd', X.durham - 99, X.madras, Z.kilmore, Z.lichfield, 5);
  a.rect('cbd-mall', 'City Mall', CH, 'shops', -123, X.manchester, Z.cashel - 40, Z.cashel + 40, 6);
  a.rect('victoria-sq', 'Victoria Square', CH, 'park', X.durham + 6, -6, Z.kilmore + 8, Z.armagh - 8, 7);
  a.rect('central-west', 'Central City', CH, 'shops', X.park, X.durham - 99, Z.bealey, Z.stAsaph, 4);
  a.rect('central-north', 'Central City', CH, 'shops', X.park, X.fitz, Z.bealey, Z.kilmore, 3);
  a.rect('central-east', 'Central City', CH, 'shops', X.madras, X.fitz, Z.bealey, Z.stAsaph, 3);
  a.rect('central-south', 'Central City', CH, 'shops', X.park, X.fitz, Z.lichfield, Z.stAsaph, 3);
  a.rect('avon-loop', 'Avon River', CH, 'park', X.colombo + 8, X.fitz - 8, -4690, -4654, 7, 'Ōtākaro');
  return avon;
}
