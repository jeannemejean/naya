-- Fenêtres d'attribution par marque — décision Jeanne du 31 août 2026.
-- Cycle B2B long pour l'agence, cycle B2C court pour Encore Merci.
-- Les autres marques gardent le défaut de 30 j : la décision ne les nomme pas et deviner
-- un cycle commercial n'est pas notre rôle. La valeur est éditable dans les réglages.
UPDATE projects SET attribution_window_days = 60 WHERE name = 'Agence JMD';
UPDATE projects SET attribution_window_days = 14 WHERE name = 'Encore Merci';
