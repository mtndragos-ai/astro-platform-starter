/**
 * Machine groups — the single source of truth for both the chat widget's
 * dropdown and the Netlify function's auto-detection fallback.
 *
 * Why this exists: retrieval is similarity-only, so a large manual can
 * crowd out the right one. FD2/FM200 alone is ~7,700 of ~12,400 chunks,
 * so a generic question ("how do I adjust the regulator") pulls its pages
 * even when the person means an iXtrack. Scoping the search to one
 * machine's manuals fixes that.
 *
 * `keywords` drive auto-detection when the dropdown is left on "All".
 * They're matched case-insensitively against the question, so keep them
 * distinctive — avoid generic words that appear across manuals.
 *
 * When adding a manual: add its slug to the right group here (and add a
 * new group if it's a new machine family). A slug missing from this file
 * still works — it's just only reachable via "All manuals".
 */

export const MACHINE_GROUPS = [
  {
    id: 'ixtrack',
    label: 'iXtrack (T3 / T4 / T6)',
    keywords: ['ixtrack', 'ix track', 't3', 't4', 't6'],
    slugs: [
      'ixtrack-t3-operators',
      'ixtrack-t4-operators',
      'ixtrack-t6-operators',
      'pdi-ixtrack-t',
    ],
  },
  {
    id: 'ixter',
    label: 'iXter (A / B)',
    keywords: ['ixter'],
    slugs: ['ixter-a-operators', 'ixter-b-operators'],
  },
  {
    id: 'ixtra',
    label: 'iXtra (Pro / Comfort / LiFe)',
    keywords: ['ixtra'],
    slugs: [
      'ixtra-pro-operators',
      'ixtra-comfort-operators',
      'ixtra-life-operators',
    ],
  },
  {
    id: 'ixspray',
    label: 'iXspray (electronics / terminal)',
    keywords: ['ixspray'],
    slugs: ['kverneland-ixspray', 'ixspray-operators'],
  },
  {
    id: 'ixflow',
    label: 'iXflow Pulse',
    keywords: ['ixflow', 'pulse', 'ncv', 'nozzle control valve', 'rcm'],
    slugs: ['kverneland-ixflow-pulse', 'ixflow-pulse-operators'],
  },
  {
    id: 'boomguide',
    label: 'Boomguide (Comfort / Pro / Pro Active)',
    keywords: ['boomguide', 'boom guide', 'uc5', 'uc7', 'norac'],
    slugs: [
      'boomguide-comfort-uc5',
      'boomguide-comfort-uc7',
      'boomguide-pro-uc5',
      'boomguide-pro-uc7',
      'boomguide-pro-active-uc5',
      'boomguide-pro-active-uc7',
    ],
  },
  {
    id: 'satio',
    label: 'Satio (drill / terminal)',
    keywords: ['satio', 'e-bas', 'ebas', 'pudama', 'visus', 'microgranulator'],
    slugs: [
      'satio-f-operators',
      'satio-operators',
      'satio-f-terminal-operators',
      'satio-f-terminal-ebas-operators',
      'pudama-operators',
      'visus-operators',
      'microgranulator-operators',
    ],
  },
  {
    id: 'udrill',
    label: 'u-drill (Plus / 6001)',
    keywords: ['udrill', 'u-drill', 'u drill', '6001'],
    slugs: ['udrill-plus-3-4m-operators', 'udrill-6001-plus-operators'],
  },
  {
    // Precision planter, not a seed drill — kept apart from Satio so a
    // question about one doesn't retrieve the other's pages.
    id: 'optima',
    label: 'Optima (HD)',
    keywords: ['optima'],
    slugs: ['optima-hd-operators'],
  },
  {
    id: 'fd2',
    label: 'FD2 Series / FM200 (MacDon)',
    keywords: ['fd2', 'fm200', 'macdon', 'draper', 'header', 'combine', 'windrower'],
    slugs: ['fd2-fm200', 'fd2-fm200-operators'],
  },
  {
    id: 't7',
    label: 'New Holland T7 Stage V',
    keywords: ['t7', 'autocommand', 'auto command', 'new holland', 't7.195', 't7.215', 't7.230', 't7.245', 't7.260', 't7.270'],
    slugs: [
      't7-contents',
      't7-introduction',
      't7-engine',
      't7-clutch',
      't7-transmission',
      't7-four-wheel-drive',
      't7-front-axle-system',
      't7-rear-axle-system',
      't7-power-take-off',
      't7-brakes-and-controls',
      't7-hydraulic-systems',
      't7-hitches-drawbars-couplings',
      't7-frames-and-ballasting',
      't7-steering',
      't7-wheels',
      't7-cab-climate-control',
      't7-electrical-systems',
      't7-platform-cab-bodywork-decals',
      't7-special-tool-index',
    ],
  },
];

/**
 * Picks a machine group from free text. Returns the group's slugs, or null
 * when nothing matches clearly (in which case the caller should search
 * everything rather than guess).
 *
 * Deliberately conservative: if two different groups match equally well, we
 * return null rather than pick one, since a wrong filter hides the right
 * answer entirely — worse than a slightly noisy search.
 *
 * But some keywords are prefixes of others ('ixtra' inside 'ixtrack',
 * 'satio' inside 'satio f'). Treating those as a genuine tie would disable
 * detection for the longer name entirely, so the longest matching keyword
 * wins: the more specific name is the one the person actually typed.
 */
export function detectMachineSlugs(question) {
  if (!question) return null;
  const text = question.toLowerCase();

  const hits = MACHINE_GROUPS.map((group) => {
    const matched = group.keywords.filter((kw) => text.includes(kw));
    return {
      group,
      // How specific the best match was. A longer keyword means the question
      // named the machine more precisely.
      strength: matched.reduce((best, kw) => Math.max(best, kw.length), 0),
    };
  }).filter((h) => h.strength > 0);

  if (hits.length === 0) return null;

  const best = Math.max(...hits.map((h) => h.strength));
  const winners = hits.filter((h) => h.strength === best);

  // A real tie between unrelated machines is still ambiguous — bail out.
  if (winners.length !== 1) return null;
  return winners[0].group.slugs;
}
