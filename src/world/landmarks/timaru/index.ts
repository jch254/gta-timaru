// Timaru landmark builders, registered by kind (see docs/CONTRACT.md for the kinds and their clear radii).
import { LANDMARKS } from '../registry';
import { basilica } from './basilica';
import { carnival, soundshell, tearooms } from './carolinebay';
import { hospital, police } from './civic';
import { raceway, saleyards, smithfield } from './industry';
import { discountStore } from './dekko';
import { nightclub } from './millstone';
import { landingService, lighthouse, port, station } from './port';
import { patitiPoint } from './patiti';
import { arcadeMall } from './rinkmall';
import { royalArcade } from './royalarcade';
import { deptStore } from './stockmans';
import { highfieldMall, northsideMall } from './suburbanmalls';

LANDMARKS['timaru-basilica'] = basilica;
LANDMARKS['caroline-bay-soundshell'] = soundshell;
LANDMARKS['caroline-bay-carnival'] = carnival;
LANDMARKS['caroline-bay-tearooms'] = tearooms;
LANDMARKS['timaru-port'] = port;
LANDMARKS['timaru-lighthouse'] = lighthouse;
LANDMARKS['landing-service-building'] = landingService;
LANDMARKS['timaru-station'] = station;
LANDMARKS['timaru-hospital'] = hospital;
LANDMARKS['timaru-police'] = police;
LANDMARKS['smithfield-works'] = smithfield;
LANDMARKS['washdyke-saleyards'] = saleyards;
LANDMARKS['phar-lap-raceway'] = raceway;
// Stafford Street and the malls (docs/research/11-timaru-landmarks.md), and Pātītī Point.
LANDMARKS['timaru-dept-store'] = deptStore;
LANDMARKS['timaru-discount-store'] = discountStore;
LANDMARKS['timaru-arcade-mall'] = arcadeMall;
LANDMARKS['timaru-nightclub'] = nightclub;
LANDMARKS['royal-arcade'] = royalArcade;
LANDMARKS['northside-mall'] = northsideMall;
LANDMARKS['highfield-mall'] = highfieldMall;
LANDMARKS['patiti-point'] = patitiPoint;
