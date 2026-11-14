// Christchurch, Port Hills and Lyttelton landmark builders. One file per landmark or group; this file only
// registers them (import the registry from '../registry', never from '../index').
import { LANDMARKS } from '../registry';
import { artsCentre, museum } from './artscentre';
import { newBrightonMall } from './brighton';
import { cathedral, cathedralSquare } from './cathedral';
import { bridgeOfRemembrance, townHall, victoriaSquare } from './civic';
import { gondolaBase, gondolaSummit, signOfTheKiwi, signOfTheTakahe, sugarloafTower } from './hills';
import { lancasterPark } from './lancaster';
import { lytteltonPort, timeballStation, tunnelPortal } from './lyttelton';
import './props';
import { antiguaBoatsheds } from './river';
import { hospital, policeStation } from './services';
import { addingtonStation, oldRailwayStation, tramStop } from './stations';

LANDMARKS['chch-cathedral'] = cathedral;
LANDMARKS['cathedral-square'] = cathedralSquare;
LANDMARKS['arts-centre'] = artsCentre;
LANDMARKS['canterbury-museum'] = museum;
LANDMARKS['bridge-of-remembrance'] = bridgeOfRemembrance;
LANDMARKS['town-hall'] = townHall;
LANDMARKS['victoria-square'] = victoriaSquare;
LANDMARKS['old-railway-station'] = oldRailwayStation;
LANDMARKS['addington-station'] = addingtonStation;
LANDMARKS['lancaster-park'] = lancasterPark;
LANDMARKS['antigua-boatsheds'] = antiguaBoatsheds;
LANDMARKS['tram-stop'] = tramStop;
LANDMARKS['chch-hospital'] = hospital;
LANDMARKS['chch-police'] = policeStation;
LANDMARKS['new-brighton-mall'] = newBrightonMall;
LANDMARKS['sign-of-the-takahe'] = signOfTheTakahe;
LANDMARKS['sign-of-the-kiwi'] = signOfTheKiwi;
LANDMARKS['sugarloaf-tower'] = sugarloafTower;
LANDMARKS['gondola-base'] = gondolaBase;
LANDMARKS['gondola-summit'] = gondolaSummit;
LANDMARKS['tunnel-portal'] = tunnelPortal;
LANDMARKS['lyttelton-port'] = lytteltonPort;
LANDMARKS['timeball-station'] = timeballStation;
