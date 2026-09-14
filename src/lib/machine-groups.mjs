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
    label: 'Satio / seeding',
    keywords: ['satio', 'e-bas', 'ebas', 'pudama', 'visus', 'microgranulator', 'optima'],
    slugs: [
      'satio-f-terminal-operators',
      'satio-f-terminal-ebas-operators',
      'pudama-operators',
      'visus-operators',
      'microgranulator-operators',
    ],
  },
  {
    id: 'fd2',
    label: 'FD2 Series / FM200 (MacDon)',
    keywords: ['fd2', 'fm200', 'macdon', 'draper', 'header', 'combine', 'windrower'],
    slugs: ['fd2-fm200', 'fd2-fm200-operators'],
  },
];

/**
 * Picks a machine group from free text. Returns the group's slugs, or null
 * when nothing matches clearly (in which case the caller should search
 * everything rather than guess).
 *
 * Deliberately conservative: if two different groups match, we return null
 * rather than pick one, since a wrong filter hides the right answer
 * entirely — worse than a slightly noisy search.
 */
export function detectMachineSlugs(question) {
  if (!question) return null;
  const text = question.toLowerCase();

  const hits = MACHINE_GROUPS.filter((group) =>
    group.keywords.some((kw) => text.includes(kw))
  );

  if (hits.length === 1) return hits[0].slugs;
  return null;
}
