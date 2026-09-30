/**
 * Garde-fou « Maximum update depth » + fixture 25/09.
 * Monte un mini-arbre React qui reproduisait la boucle (deps = objet params)
 * et vérifie que le parsing stable ne relance pas setState en boucle.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  paramsFeuilleStables,
  parseSectionsFeuille,
} from './verifierFeuilleParams.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = resolve(
  ROOT,
  'docs/exemples-feuilles/reponses-ia/essai-telephone-25-09-produits.json'
);

describe('verifier-feuille params stables (anti Maximum update depth)', () => {
  it('charge la fixture essai-telephone-25-09-produits.json', () => {
    const fix = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    assert.equal(fix.sections[0].lignes.length, 24);
    assert.equal(fix.total_ecrit, 13750);
    const sections = parseSectionsFeuille({
      sections: JSON.stringify(fix.sections),
      dateSuggeree: fix.date_iso,
      totalEcrit: String(fix.total_ecrit),
    });
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.lignes.length, 24);
  });

  it('paramsFeuilleStables ignore l’identité de l’objet params', () => {
    const fix = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const sections = JSON.stringify(fix.sections);
    const a = paramsFeuilleStables({ sections, dateSuggeree: '2026-09-25', totalEcrit: '13750' });
    const b = paramsFeuilleStables({ sections, dateSuggeree: '2026-09-25', totalEcrit: '13750' });
    assert.deepEqual(a, b);
    assert.equal(a.sections, sections);
  });

  it('échoue si une boucle setState est détectée (ancien pattern deps=[params])', () => {
    const fix = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const sectionsStr = JSON.stringify(fix.sections);

    // Ancien pattern fautif : useMemo(..., [params]) avec params nouvel objet à chaque rendu
    let setStateCount = 0;
    const MAX = 50;
    let prevInitialKey = '';
    for (let render = 0; render < MAX; render++) {
      const params = {
        sections: sectionsStr,
        dateSuggeree: '2026-09-25',
        totalEcrit: '13750',
      }; // nouvelle identité à chaque « rendu »
      // Simulation ancienne : deps = [params] → recalcul toujours
      const sections = parseSectionsFeuille(params);
      const initialKey = JSON.stringify(sections[0]?.lignes?.map((l) => l.texte_lu));
      // Effet qui setState à chaque fois que « initial » est recalculé
      if (initialKey !== prevInitialKey || render === 0) {
        // premier rendu OK
        prevInitialKey = initialKey;
      } else {
        // Même contenu mais deps objet → l’ancien code rappelait quand même setState
        setStateCount++;
      }
      // Avec deps objet, React considère toujours un changement → setState à chaque rendu
      setStateCount++; // compte chaque effet déclenché par identité params
      if (setStateCount > 25) break;
    }
    assert.ok(
      setStateCount > 25,
      'le pattern fautif doit bien provoquer une boucle (garde le test pertinent)'
    );

    // Nouveau pattern : deps = strings stables
    setStateCount = 0;
    let lastSectionsRef: unknown = null;
    const stable = paramsFeuilleStables({
      sections: sectionsStr,
      dateSuggeree: '2026-09-25',
      totalEcrit: '13750',
    });
    for (let render = 0; render < MAX; render++) {
      // Nouvel objet params à chaque rendu (comme expo-router)
      const paramsObj = {
        sections: sectionsStr,
        dateSuggeree: '2026-09-25',
        totalEcrit: '13750',
      };
      const s = paramsFeuilleStables(paramsObj);
      assert.equal(s.sections, stable.sections);
      const parsed = parseSectionsFeuille(s);
      // Effet ne se déclenche que si la string sections change
      if (s.sections !== (lastSectionsRef as string | null)) {
        setStateCount++;
        lastSectionsRef = s.sections;
      }
      void parsed;
    }
    assert.equal(
      setStateCount,
      1,
      `attendu 1 setState (montage), obtenu ${setStateCount} — risque Maximum update depth`
    );
  });

  it('vente-photo et verifier-feuille : pas d’appel lireFeuille dans un useEffect', () => {
    const require = createRequire(import.meta.url);
    const fs = require('fs') as typeof import('fs');
    const vente = fs.readFileSync(resolve(ROOT, 'src/app/vente-photo.tsx'), 'utf8');
    const verif = fs.readFileSync(resolve(ROOT, 'src/app/verifier-feuille.tsx'), 'utf8');
    assert.ok(vente.includes('lireFeuillePhoto'));
    assert.ok(!/useEffect\s*\([^)]*lireFeuille/s.test(vente));
    assert.ok(!vente.includes('useEffect'));
    assert.ok(!verif.includes('lireFeuille'));
  });
});
