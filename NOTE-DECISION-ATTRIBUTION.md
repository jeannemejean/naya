# Note de décision — le schéma de pondération multi-touch (Lot 3B, §4.0)

> Point d'arrêt du `BRIEF-PHASE-3-RECEPTION-ARBITRAGE.md`. À trancher par Jeanne avant tout code d'attribution.
> Cette note ne code rien. Elle chiffre les deux options sur un cas concret, dit ce que chacune **affirme** sans le dire, et recommande.

---

## 0. DÉCISION ACTÉE (Jeanne, 31 août 2026)

Le point d'arrêt §4.0 du brief est **levé**. Les trois arbitrages :

1. **Schéma de pondération : linéaire uniforme (option A).** Chaque contenu de la fenêtre reçoit `1/n`. À implémenter comme un **défaut provisoire nommé comme tel dans le code**, avec les conditions de bascule du §6 écrites en commentaire au même endroit — pas dans un ticket, pas dans un document séparé.
2. **Fenêtre d'attribution : réglée par marque dès maintenant.** `projects.attribution_window_days` garde son défaut de 30 j pour les nouveaux projets, mais les marques existantes sont initialisées selon leur cycle réel : **60 j pour l'Agence JMD** (B2B, cycle long), **14 j pour les marques B2C** (Encore Merci et assimilées). Une migration de données ponctuelle, relue avant application, et la valeur reste éditable depuis les réglages du projet.
3. **Règle de bord : inclusive.** Un contenu publié exactement à `J − attributionWindowDays` **est dans la fenêtre**. Le test doit l'écrire explicitement, aux deux bornes.

Le raisonnement complet est ci-dessous et reste la référence. Ces trois points ne sont plus à rediscuter à l'implémentation.

---

## 1. Le cas de test

Une marque, fenêtre d'attribution **30 jours**, une conversion le jour J (un rendez-vous qui devient un client). Cinq contenus publiés avant :

| Contenu | Publié | Intention | Ce que c'était |
|---|---|---|---|
| C1 | J−28 | awareness | Une tribune d'opinion sur le marché — le contenu qui a fait découvrir la marque |
| C2 | J−21 | consideration | Une étude de cas client |
| C3 | J−14 | awareness | Un contenu de coulisses |
| C4 | J−6 | conversion | Un post d'offre |
| C5 | J−2 | conversion | Un rappel de disponibilité |

## 2. Les deux schémas, chiffrés

**Option A — linéaire uniforme :** chaque contenu de la fenêtre reçoit `1/n`.
**Option B — décroissance exponentielle :** poids brut `0.5^(âge / demi-vie)` avec demi-vie = fenêtre / 3 = 10 jours, puis normalisation à 1.

| Contenu | Âge | Poids brut (B) | **A — linéaire** | **B — exponentiel** |
|---|---|---|---|---|
| C1 J−28 | 28 j | 0,14359 | **20,0 %** | **6,3 %** |
| C2 J−21 | 21 j | 0,23326 | **20,0 %** | **10,2 %** |
| C3 J−14 | 14 j | 0,37893 | **20,0 %** | **16,6 %** |
| C4 J−6 | 6 j | 0,65975 | **20,0 %** | **28,9 %** |
| C5 J−2 | 2 j | 0,87055 | **20,0 %** | **38,1 %** |
| | | | 100 % | 100 % |

## 3. Le test décisif — regrouper par intention

C'est là que le choix cesse d'être cosmétique :

| Intention | **A — linéaire** | **B — exponentiel** |
|---|---|---|
| awareness (C1 + C3) | 40,0 % | **22,9 %** |
| consideration (C2) | 20,0 % | 10,2 % |
| conversion (C4 + C5) | 40,0 % | **67,0 %** |

**Sous B, les deux posts d'offre captent les deux tiers du crédit.** Naya en tirera une leçon, et cette leçon remontera dans la génération de contenu : *« les posts d'offre convertissent, fais-en plus. »*

Or dans le scénario décrit, ce qui a produit le client, c'est probablement C1 — la tribune qui a fait découvrir la marque 28 jours plus tôt. Le post d'offre n'a fait que ramasser une intention déjà construite. B le crédite à 6,3 %, c'est-à-dire invisible dans n'importe quel classement.

**Ce que chaque option affirme sans le dire :**
- **B affirme que la proximité temporelle est un indice de causalité.** C'est une hypothèse forte, et c'est exactement le type de raccourci que ta note `STRATEGIE-DONNEES-ET-POSITIONNEMENT.md` §1 refuse : une activité proche d'un résultat n'est pas sa cause.
- **A n'affirme rien.** Elle dit « la conversion vient de la fenêtre, je ne sais pas de quel contenu ». C'est moins satisfaisant et plus honnête.

## 4. Ce que personne ne devrait invoquer dans ce choix

**« La demi-vie exponentielle, on l'utilise déjà pour la mémoire. »** Non. Les demi-vies de `retrieve.ts` (180 / 45 / 10 j) régissent la **pertinence d'un souvenir pour la décision en cours**. Ici on parle de **crédit causal d'un contenu dans un résultat**. Les deux courbes se ressemblent et ne disent pas la même chose ; importer la forme parce qu'elle est familière est précisément le glissement que la stratégie dénonce.

**« Le linéaire est naïf quand le volume est irrégulier. »** Vrai, mais ce n'est pas un argument pour B : douze posts publiés en une semaine diluent le crédit dans les **deux** schémas. Le volume est un problème réel qu'aucune des deux courbes ne résout — à traiter séparément, pas en déguisant la solution en choix de pondération.

## 5. Ce qui pèse plus lourd que la courbe : la fenêtre

Mêmes cinq contenus, on ne change que `attributionWindowDays` :

| | C1 J−28 | C2 J−21 | C3 J−14 | C4 J−6 | C5 J−2 |
|---|---|---|---|---|---|
| Fenêtre 60 j — linéaire | 20,0 % | 20,0 % | 20,0 % | 20,0 % | 20,0 % |
| Fenêtre 30 j — linéaire | 20,0 % | 20,0 % | 20,0 % | 20,0 % | 20,0 % |
| **Fenêtre 14 j — linéaire** | **exclu** | **exclu** | 33,3 % | 33,3 % | 33,3 % |

La fenêtre est un **binaire** : dedans ou dehors. Elle est bien plus violente que n'importe quelle courbe de pondération — et elle est déjà réglable **par marque** dans le schéma (`projects.attribution_window_days`, défaut 30).

Conséquence pratique : régler correctement la fenêtre par marque change davantage tes résultats que le choix A/B. Pour l'Agence JMD (B2B, cycle long, ta note évoque 60-90 jours pour ce type de cible), 30 jours est probablement **trop court** — la moitié du chemin de décision d'un client est hors fenêtre. Pour Encore Merci (B2C), 7 à 14 jours est plus juste.

## 6. Recommandation

**Option A — linéaire uniforme**, étiquetée dans le code comme un défaut provisoire, pas comme une vérité.

Quatre raisons :

1. **Asymétrie des erreurs.** Si A se trompe, un contenu réellement décisif reçoit 20 % au lieu de 50 % : il reste visible. Si B se trompe, un contenu réellement décisif reçoit 6 % : il disparaît. Quand on ne peut pas vérifier, on choisit le schéma dont l'échec est le moins destructeur.
2. **Tu ne peux rien calibrer aujourd'hui.** Une utilisatrice, quelques conversions par semestre. Le brief le dit : le schéma est « à calibrer sur données réelles ». Choisir B maintenant, c'est figer une hypothèse causale au moment précis où on n'a aucun moyen de la tester.
3. **Ton cycle est long.** Une demi-vie de 10 jours rend quasi muet tout ce qui a plus de trois semaines. Sur ton activité d'agence, c'est là que vit la vraie construction.
4. **C'est réversible sans coût.** `conversion_attributions` stocke le poids, et le recalcul est idempotent (déjà exigé au §4.1 du brief). Basculer vers B plus tard, c'est relancer un script — pas une migration, pas une perte.

**Les conditions de bascule vers B, à écrire dans le code maintenant** — pour que ce ne soit pas une intention oubliée :
- au moins 20 conversions attribuées, sur au moins 2 marques ;
- et un écart mesurable entre l'âge médian des contenus des fenêtres qui ont converti et celui des fenêtres qui n'ont pas converti ;
- sinon, on ne bascule pas, quelle que soit l'intuition.

## 7. Ce qu'il reste à trancher avec la pondération

- [ ] **A ou B** (recommandation : A).
- [ ] **Fenêtre par défaut** : garder 30 j pour tout le monde, ou poser dès maintenant 60 j sur l'Agence JMD et 14 j sur les marques B2C ? *(recommandation : régler par marque tout de suite — c'est le levier le plus fort, et il ne coûte rien)*
- [ ] **Règle de bord** : un contenu publié exactement à J − fenêtre est-il dans la fenêtre ? *(recommandation : oui, inclusif — et le test l'écrit)*

> Rappel du brief, valable quelle que soit la réponse : la somme des poids d'une conversion vaut exactement 1, jamais de last-touch, et une conversion sans contenu dans sa fenêtre existe sans être créditée à personne.
