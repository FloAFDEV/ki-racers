// Définition des circuits. Points de contrôle : [x, hauteur, z].
// `at` = position exprimée en index de point de contrôle (5.5 = à mi-chemin entre les points 5 et 6).
// Chaque point peut porter des attributs valables jusqu'au point suivant :
//   w  demi-largeur de route · sh largeur d'accotement · eL/eR bord gauche/droit ('wall' | 'void')

const wall = { eL: 'wall', eR: 'wall' };
const rail = { eL: 'wall', eR: 'wall', sh: 0 };
const open = { eL: 'void', eR: 'void', sh: 0 };

export const TRACKS = [
  {
    id: 'peaks',
    name: 'Pics Émeraude',
    theme: 'mountain',
    pts: [
      { p: [0, 0, 0] }, { p: [140, 0, 0] }, { p: [260, 2, 5] }, { p: [335, 8, 70] },
      { p: [345, 16, 160] }, { p: [285, 24, 235] }, { p: [180, 28, 255] }, { p: [70, 24, 230] },
      { p: [25, 20, 330] }, { p: [-80, 17, 365] }, { p: [-155, 14, 300] }, { p: [-230, 8, 200] },
      { p: [-265, 4, 90] }, { p: [-200, 1, -10] }, { p: [-90, 0, -30] },
    ],
    defaults: { w: 9, sh: 3, ...wall },
    jumps: [{ at: 1.2, len: 20, rise: 4.5 }, { at: 5.45, len: 20, rise: 4.5 }],
    pads: [{ at: 4.2 }, { at: 11.2 }],
    caps: [{ at: 2.6 }, { at: 6.7 }, { at: 9.0 }, { at: 13.4 }],
    orbs: [
      { at: 0.55, lat: 5 }, { at: 1.2, ahead: 14, air: 7 }, { at: 3.5, lat: -5 }, { at: 8.6, lat: 0 },
      { sc: 0, t: 0.5 }, { at: 12.6, lat: 4 }, { sc: 1, t: 0.5 },
    ],
    shortcuts: [
      { // corniche étroite sans barrière
        name: 'Corniche du Vertige', from: 7.0, to: 10.5,
        pts: [[-10, 22, 232], [-100, 18, 250], [-160, 15, 262]],
        w: 3.6, ...open, special: 0.62, aiSkill: 0.55,
      },
      { // coupe dans la terre meuble : rentable seulement avec un boost
        name: 'Sentier Boueux', from: 11.3, to: 14.3,
        pts: [[-228, 6, 115], [-185, 3, 50], [-125, 1, 0]],
        w: 5, ...rail, rough: true, special: 0.7, aiNeedsBoost: true,
      },
    ],
  },
  {
    id: 'dunes',
    name: 'Canyon des Dunes',
    theme: 'desert',
    pts: [
      { p: [0, 0, 0] }, { p: [150, 0, 0] }, { p: [290, 2, -25] }, { p: [400, 5, -100] },
      { p: [400, 8, -230] }, { p: [270, 10, -290] }, { p: [150, 8, -240] }, { p: [70, 5, -150] },
      { p: [-30, 5, -170] }, { p: [-100, 8, -260] }, { p: [-230, 12, -340] }, { p: [-320, 9, -210] },
      { p: [-330, 4, -80] }, { p: [-245, 2, -5] }, { p: [-120, 0, 12] },
    ],
    defaults: { w: 10, sh: 4, ...wall },
    jumps: [{ at: 1.2, len: 20, rise: 4.5 }, { at: 12.25, len: 20, rise: 4.5 }],
    pads: [{ at: 6.3 }, { at: 13.3 }],
    caps: [{ at: 2.0 }, { at: 4.5 }, { at: 7.5 }, { at: 10.0 }, { at: 11.8 }],
    orbs: [
      { at: 0.5, lat: -5 }, { at: 3.6, lat: 0 }, { sc: 0, t: 0.5 }, { at: 6.6, lat: 5 },
      { at: 9.9, lat: 0 }, { sc: 1, t: 0.2 }, { at: 12.25, ahead: 14, air: 7 },
    ],
    shortcuts: [
      { // coupe par les dunes
        name: 'Mer de Sable', from: 2.4, to: 5.3,
        pts: [[345, 4, -120], [325, 7, -200], [285, 9, -255]],
        w: 5.5, ...rail, rough: true, special: 0.6, aiNeedsBoost: true,
      },
      { // saut au-dessus du canyon : il faut de la vitesse
        name: 'Saut du Canyon', from: 9.0, to: 11.3,
        pts: [[-170, 9, -272], [-240, 10, -262], [-290, 10, -228]],
        w: 5.5, ...rail, jump: { t: 0.4, len: 20, rise: 2 }, hole: [0.4, 0.49],
        special: 0.75, aiSpeed: 47,
      },
    ],
  },
  {
    id: 'skyway',
    name: 'Voie Céleste',
    theme: 'sky',
    pts: [
      { p: [0, 40, 0] }, { p: [140, 40, 0], ...rail }, { p: [250, 44, 40], ...rail }, { p: [300, 50, 130], ...rail },
      { p: [250, 56, 220], ...rail }, { p: [140, 60, 240], ...rail }, { p: [40, 60, 180] }, { p: [-60, 57, 60] },
      { p: [-120, 52, -40], ...rail }, { p: [-200, 46, -120], ...rail }, { p: [-300, 42, -80], ...rail },
      { p: [-330, 40, 20], ...rail }, { p: [-260, 40, 100], ...rail }, { p: [-170, 40, 40] }, { p: [-90, 40, 5] },
    ],
    defaults: { w: 9.5, sh: 0, ...open },
    jumps: [{ at: 0.5, len: 20, rise: 4.5 }, { at: 8.2, len: 20, rise: 4.5 }],
    pads: [{ at: 6.4 }, { at: 13.4 }],
    caps: [{ at: 1.6 }, { at: 4.4 }, { at: 7.4 }, { at: 10.5 }, { at: 12.8 }],
    orbs: [
      { at: 0.5, ahead: 14, air: 7 }, { at: 3.4, lat: 4 }, { sc: 0, t: 0.5 }, { at: 5.6, lat: -3 },
      { at: 7.0, lat: 0 }, { at: 10.9, lat: 3 }, { sc: 1, t: 0.22 },
    ],
    shortcuts: [
      { // passerelle étroite dans le vide
        name: 'Fil du Ciel', from: 2.3, to: 5.2,
        pts: [[265, 48, 115], [228, 54, 185], [178, 58, 226]],
        w: 3.6, ...open, special: 0.55, aiSkill: 0.5,
      },
      { // tremplin entre deux îles
        name: 'Brèche des Nuages', from: 9.2, to: 12.4,
        pts: [[-258, 44, -62], [-268, 42, 5], [-250, 40, 58]],
        w: 5.5, ...rail, jump: { t: 0.42, len: 20, rise: 2 }, hole: [0.42, 0.52],
        special: 0.8, aiSpeed: 47,
      },
    ],
  },
];
