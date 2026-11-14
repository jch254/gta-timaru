// Timaru landmark builders, registered by kind (see docs/CONTRACT.md for the kinds and their clear radii).
import { LANDMARKS } from '../registry';
import { basilica } from './basilica';
import { carnival, soundshell, tearooms } from './carolinebay';
import { hospital, police } from './civic';
import { raceway, saleyards, smithfield } from './industry';
import { landingService, lighthouse, port, station } from './port';

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
