// Rural and small-town landmark builders, registered by kind (see docs/CONTRACT.md for the kinds and their
// clear radii). These are placed many times, so each varies with a seed taken from its coordinates.
import { LANDMARKS } from '../registry';
import { clockTower, rugbyField, salmon, school } from './civic';
import { grainSilo, woolshed } from './farm';
import { marae } from './marae';
import { countryChurch, countryPub, railStationSmall, serviceStation, warMemorial } from './township';

LANDMARKS['ashburton-clock-tower'] = clockTower;
LANDMARKS['rakaia-salmon'] = salmon;
LANDMARKS['woolshed'] = woolshed;
LANDMARKS['grain-silo'] = grainSilo;
LANDMARKS['service-station'] = serviceStation;
LANDMARKS['country-pub'] = countryPub;
LANDMARKS['country-church'] = countryChurch;
LANDMARKS['war-memorial'] = warMemorial;
LANDMARKS['school'] = school;
LANDMARKS['rugby-field'] = rugbyField;
LANDMARKS['rail-station-small'] = railStationSmall;
LANDMARKS['marae'] = marae;
