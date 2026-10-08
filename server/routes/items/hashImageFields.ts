import { getScalarType, ScalarTypes } from '@roostorg/coop-types';

import { type Dependencies } from '../../iocContainer/index.js';
import { type ItemType } from '../../services/moderationConfigService/index.js';
import { withRetries } from '../../utils/misc.js';

type HashService = Pick<
  Dependencies['HMAHashBankService'],
  'listBanks' | 'hashContentFromUrl' | 'checkImageMatchWithDetails'
>;

type ImageValue = string | { url: string; [key: string]: unknown };

/**
 * Computes HMA hashes for every Image-typed field in the item's schema
 * (singular or array, whatever the field is named) and writes them back onto
 * `data`, in the same shape the field already had, so that signals like
 * IMAGE_SIMILARITY_MATCH can read `hashes` and `matchedBanks` from the values.
 *
 * NB: This mutates `data`.
 */
export async function addHashesToImageFields({
  itemType,
  data,
  orgId,
  HMAHashBankService,
}: {
  itemType: Pick<ItemType, 'schema'>;
  data: { [key: string]: unknown };
  orgId: string;
  HMAHashBankService: HashService;
}) {
  const imageFields = itemType.schema.filter(
    (field) =>
      getScalarType(field) === ScalarTypes.IMAGE && data[field.name] != null,
  );
  if (imageFields.length === 0) {
    return;
  }

  try {
    // Get all hash banks for this org once
    const allBanks = await HMAHashBankService.listBanks(orgId);
    const allBankNames = allBanks.map((bank) => bank.hma_name);

    const hashImage = async (image: ImageValue) => {
      const url = typeof image === 'string' ? image : image.url;
      // Preserve any fields the coercion step already populated on the media
      // object, rather than rebuilding a fresh object that drops them.
      const coercedFields = typeof image === 'string' ? {} : image;
      if (typeof url !== 'string' || !url) {
        return null;
      }

      try {
        const hmaHashWithRetries = await withRetries(
          {
            maxRetries: 5,
            initialTimeMsBetweenRetries: 5,
            maxTimeMsBetweenRetries: 500,
            jitter: true,
          },
          async () => HMAHashBankService.hashContentFromUrl(url),
        );
        const hashes = await hmaHashWithRetries();

        // Check which banks match this image
        const matchedBankNames: string[] = [];

        if (Object.keys(hashes).length > 0 && allBankNames.length > 0) {
          const matchResults = await Promise.all(
            Object.entries(hashes).map(async ([signalType, hash]) =>
              HMAHashBankService.checkImageMatchWithDetails(
                allBankNames,
                signalType,
                hash,
              ),
            ),
          );

          const allMatchedHmaBanks = new Set<string>();
          matchResults.forEach((result) => {
            result.matchedBanks.forEach((bank) => allMatchedHmaBanks.add(bank));
          });

          // Map HMA bank names to user-friendly names
          allMatchedHmaBanks.forEach((hmaName) => {
            const bank = allBanks.find((b) => b.hma_name === hmaName);
            if (bank) {
              matchedBankNames.push(bank.name);
            }
          });
        }

        return {
          ...coercedFields,
          url,
          hashes,
          matchedBanks:
            matchedBankNames.length > 0 ? matchedBankNames : undefined,
        };
      } catch (e) {
        return { ...coercedFields, url, hashes: {} };
      }
    };

    for (const field of imageFields) {
      const value = data[field.name];
      if (field.type === 'ARRAY') {
        if (Array.isArray(value) && value.length > 0) {
          data[field.name] = await Promise.all(
            (value as ImageValue[]).map(hashImage),
          );
        }
      } else if (value != null) {
        const hashed = await hashImage(value as ImageValue);
        if (hashed) {
          data[field.name] = hashed;
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get HMA hashes for images:', error);
  }
}
