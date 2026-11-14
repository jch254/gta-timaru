import type { MissionDef } from '../types';
import { JOCK, line, MACK, RENA } from './cast';

/**
 * 1. Timaru. Pinch the works manager's ute from the Smithfield car park and get it to Jock's lock-up at the
 * port without wrecking it. Teaches taking a vehicle and driving it gently.
 */
export const severancePay: MissionDef = {
  id: 'severance-pay',
  title: 'Severance Pay',
  giver: RENA,
  initial: 'R',
  blurb: "Forty laid off at Smithfield, and the works manager bought himself a new ute the same week. Rena reckons it would about cover your holiday pay. Jock Ferrier at the port lock-up is buying.",
  reward: 200,
  placeId: 'timaru-chipshop',
  failIf: [{ kind: 'vehicleDestroyed', vehicle: 'ute', reason: "The ute's a write-off, and so is your holiday pay" }],
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(RENA, 'Kia ora, Mack. Sit down. Fourteen years on the chain and they tell you by letter.'),
        line(RENA, 'Forty of you gone, and that manager, Prentice, buys himself a new ute the same week.'),
        line(RENA, "It's parked at the works. Jock Ferrier at the port lock-up pays cash. Call it your holiday pay."),
        line(MACK, "You want me to steal the boss's ute."),
        line(RENA, "I want you to stop looking like a dropped pie. The bank's rung me twice this week about the shop, so we could both use a win."),
        line(RENA, "Go on. And don't scratch it. Jock pays by the panel."),
      ],
    },
    { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'smithfield-carpark' },
    {
      kind: 'goTo',
      to: 'smithfield-carpark',
      radius: 40,
      marker: false,
      objective: 'Get out to the freezing works car park at Smithfield',
      cues: [{ at: 12, lines: [line(MACK, "Fourteen years through that gate. First time I've gone looking for the manager's park.")] }],
    },
    {
      kind: 'enterVehicle',
      vehicle: 'ute',
      objective: "Nick the works manager's ute",
      toast: 'Walk up to a vehicle and press Interact to take it',
      lines: [line(MACK, "There she is. Dealer's sticker still in the window.")],
    },
    {
      kind: 'deliverVehicle',
      vehicle: 'ute',
      to: 'timaru-port-lockup',
      radius: 9,
      minHealth: 0.5,
      handover: true,
      objective: "Get the ute to Jock's lock-up at the port in one piece",
      returnObjective: 'Get back in the ute',
      damageReason: "Jock won't pay for scrap",
      lines: [line(MACK, 'Sorry, Mr Prentice. Call it a restructure.')],
      cues: [{ at: 28, lines: [line(MACK, 'Easy on the kerbs. Jock pays by the panel.')] }],
    },
    {
      kind: 'say',
      lines: [
        line(JOCK, "Rena's boy? Bring her in, bring her in, before the harbour board takes an interest."),
        line(JOCK, "Barely a mark on her. I'll have the plates off before the tide turns."),
        line(JOCK, 'Two hundred. And tell your aunty she still owes me a feed of blue cod.'),
        line(MACK, 'She says you owe her.'),
        line(JOCK, "Aye. Thirty years of that. Away you go, she'll have more for you."),
      ],
    },
  ],
};
