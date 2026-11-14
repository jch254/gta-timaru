import type { CityId } from './types';

/**
 * Te reo Māori names for the towns and features in the game, shown alongside the English names in the
 * HUD and on the map. (Road signs in the world stay English-only: official dual names date from the
 * 1998 Ngāi Tahu settlement, three years after the game is set.) Only well-attested names are listed.
 */
export const CITY_TE_REO: Partial<Record<CityId, string>> = {
  christchurch: 'Ōtautahi',
  timaru: 'Te Tihi-o-Maru',
  lyttelton: 'Ōhinehou',
  ashburton: 'Hakatere',
  temuka: 'Te Umu Kaha',
  washdyke: 'Waitarakao',
};

/** Natural features by their English name. */
export const FEATURE_TE_REO: Record<string, string> = {
  'Avon River': 'Ōtākaro',
  'Lyttelton Harbour': 'Whakaraupō',
  'Port Hills': 'Ngā Kōhatu Whakarakaraka o Tamatea Pōkai Whenua',
  'Canterbury Plains': 'Kā Pākihi-whakatekateka-a-Waitaha',
  'Southern Alps': 'Kā Tiritiri o te Moana',
  'Ashburton River': 'Hakatere',
  'Opihi River': 'Ōpihi',
};

export const CITY_NAMES: Record<CityId, string> = {
  christchurch: 'Christchurch',
  timaru: 'Timaru',
  lyttelton: 'Lyttelton',
  newbrighton: 'New Brighton',
  ashburton: 'Ashburton',
  temuka: 'Temuka',
  rakaia: 'Rakaia',
  washdyke: 'Washdyke',
};
