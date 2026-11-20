import type { MissionDef } from '../types';
import { JOCK, line, MACK, RENA } from './cast';

/**
 * 1. Timaru, late February 1995: the end of the killing season, in the summer's worst heatwave (the country's
 * high, 37.0C, was set at Geraldine on the Sunday). Mack is a seasonal man: fourteen seasons on the chain at
 * Smithfield, and the letter says he is not called back for the next one, while the works manager Prentice
 * bought himself a new ute. Pinch the ute from the Smithfield car park and get it to Jock's lock-up at the
 * port without wrecking it, with Prentice's foreman on the gate to turn a quiet theft into something that
 * is seen and shouted about. Teaches taking a vehicle and driving it gently. The law is deliberately kept
 * out of the tutorial: being wanted is taught in the next job, where a fast getaway and a careful one do
 * not pull against each other in the same breath.
 */
export const severancePay: MissionDef = {
  id: 'severance-pay',
  title: 'Severance Pay',
  giver: RENA,
  initial: 'R',
  blurb: "Fourteen seasons on the chain at Smithfield and Mack is not called back for the next one. A letter for him, a new ute for Prentice the works manager. Rena reckons the ute would about cover your holiday pay, and Jock Ferrier at the port lock-up is buying.",
  reward: 200,
  placeId: 'timaru-chipshop',
  failIf: [{ kind: 'vehicleDestroyed', vehicle: 'ute', reason: "The ute's a write-off, and so is your holiday pay" }],
  steps: [
    {
      kind: 'say',
      block: true,
      objective: null,
      lines: [
        line(RENA, 'Kia ora, Mack. Sit down. Fourteen seasons on the chain, and they tell you in four lines. Not called back. Don\'t come in August. A letter.'),
        line(RENA, 'And Prentice, the manager who signed it, went and bought himself a new ute the same week. Half of Smithfield watched him park it, the smug bastard.'),
        line(RENA, "It's sitting at the works now. Jock Ferrier at the port lock-up pays cash, no questions. Call it your holiday pay."),
        line(MACK, "You want me to nick the boss's fucking ute."),
        line(RENA, "I want you to stop moping round like a dropped pie. The bank's rung me twice this week about the shop, so we could both do with a win."),
        line(RENA, "Go on, rattle your dags before the tar melts. And don't you scratch it. Jock pays by the panel."),
        line(MACK, 'Sweet as. Any chance of a scoop of chips first?'),
      ],
    },
    { kind: 'spawnVehicle', as: 'ute', spec: 'ute', at: 'smithfield-carpark' },
    // Prentice's foreman is still on the gate. He is the reason this does not go quietly.
    {
      kind: 'spawnPeds',
      peds: [
        {
          as: 'foreman',
          at: { place: 'smithfield-carpark', snap: 'verge', along: 14 },
          name: 'Foreman',
          kind: 'scripted',
          behaviour: 'stand',
          look: { topStyle: 'jacket', top: 0x8a8578, legs: 0x3a3f48, shoes: 0x2a1a12, hat: 'cap', hatColor: 0xd8d2c4, bulk: 1.1 },
        },
      ],
    },
    {
      kind: 'goTo',
      to: 'smithfield-carpark',
      radius: 40,
      marker: false,
      objective: 'Get out to the freezing works car park at Smithfield',
      lines: [line(RENA, "After. Hot chips are for working men, and as of today you're working for me.")],
      cues: [
        { at: 12, lines: [line(MACK, "Fourteen fucking seasons through that gate. First time I've ever gone looking for the manager's park.")] },
        { at: 26, lines: [line(MACK, "Stinking bloody hot. Nor'wester like an open oven door, and the tar going soft on the road. End of February and no end to it.")] },
        { at: 42, lines: [line(MACK, "Kids outside the dairy with ice blocks running down their arms. I'd give my left nut for a hokey pokey cone.")] },
      ],
    },
    {
      kind: 'enterVehicle',
      vehicle: 'ute',
      objective: "Nick the works manager's ute",
      toast: 'Walk up to a vehicle and press Interact to take it',
      lines: [line(MACK, "There she is. Dealer's sticker still in the window. Smug prick's never even had her off the seal.")],
    },
    { kind: 'checkpoint', label: 'the works car park', at: 'smithfield-carpark' },
    {
      kind: 'deliverVehicle',
      vehicle: 'ute',
      to: 'timaru-port-lockup',
      radius: 14,
      minHealth: 0.5,
      handover: true,
      objective: "Get the ute to Jock's lock-up at the port in one piece",
      returnObjective: 'Get back in the ute',
      damageReason: "Jock won't pay for scrap",
      lines: [line(MACK, 'Sorry, Mr Prentice. Call it a restructure.')],
      cues: [
        // The turn: the foreman clocks the theft. He shouts, he names Mack. But he is one man on a gate, not
        // the law, so the drive stays about keeping the ute whole, not outrunning a siren.
        { at: 4, lines: [line('Foreman', "Oi! OI! That's Mr Prentice's fucking ute! I can see you, Tully, you thieving prick! Barry Dalgety saw you, remember that!"), line('Foreman', "You're fucked, Tully! Fucked!"), line(MACK, "I'll remember, Barry. Say hello to the wife.")] },
        { at: 30, lines: [line(MACK, 'Easy on the kerbs, ya useless egg. Jock pays by the panel.')] },
        { at: 50, lines: [line(MACK, 'Brand new ute on Timaru roads. Bit of a mission keeping her pretty. Christ on a bike, that pothole.')] },
        { at: 70, lines: [line(MACK, "Bet Caroline Bay's chocka today. Half of Timaru in their togs, and the other half queued at the kiosk.")] },
      ],
    },
    {
      kind: 'say',
      // Jock's door swallows the ute, the plates and the whole question of who saw what.
      lines: [
        line(JOCK, "Gidday. Rena's boy? Bring her in, bring her in, before the bloody harbour board takes an interest."),
        line(JOCK, 'Barry Dalgety rang the works, not the constable. Wanted Prentice to know it was you personally. Christ, there\'s a man who loves his job.'),
        line(JOCK, "Not called back, I heard. That's rough as guts, son. Bastards."),
        line(JOCK, 'Since that big works by Ashburton went under last March, the whole district knows somebody with a letter like yours.'),
        line(JOCK, "Barely a mark on her. Good as gold. I'll have the plates off the bugger before the tide turns."),
        line(JOCK, 'Two hundred. And tell your aunty she still owes me a feed of blue cod.'),
        line(MACK, 'She says you owe her.'),
        line(JOCK, "Aye. Thirty bloody years of that. Away you go, she'll have more for you."),
      ],
    },
  ],
};
