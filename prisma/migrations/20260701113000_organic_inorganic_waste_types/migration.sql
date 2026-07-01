UPDATE "WasteType"
SET
  "name" = 'Organik',
  "unit" = 'KG',
  "minWeightGrams" = 100,
  "maxWeightGrams" = 50000,
  "defaultRewardPerItem" = 100,
  "description" = 'Sampah organik seperti sisa makanan, daun, dan material mudah terurai.'
WHERE "name" = 'Botol Plastik (PET)';

UPDATE "WasteType"
SET
  "name" = 'Anorganik',
  "unit" = 'KG',
  "minWeightGrams" = 100,
  "maxWeightGrams" = 50000,
  "defaultRewardPerItem" = 150,
  "description" = 'Sampah anorganik seperti plastik, logam, kaca, dan material sulit terurai.'
WHERE "name" = 'Kaleng Aluminium';

UPDATE "RewardRate"
SET
  "unit" = 'KG',
  "pointsPerItem" = 100,
  "minWeightGrams" = 100,
  "maxWeightGrams" = 50000
WHERE "wasteTypeId" IN (
  SELECT "id" FROM "WasteType" WHERE "name" = 'Organik'
);

UPDATE "RewardRate"
SET
  "unit" = 'KG',
  "pointsPerItem" = 150,
  "minWeightGrams" = 100,
  "maxWeightGrams" = 50000
WHERE "wasteTypeId" IN (
  SELECT "id" FROM "WasteType" WHERE "name" = 'Anorganik'
);
