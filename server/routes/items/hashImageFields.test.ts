import { vi } from 'vitest';

import { type ItemType } from '../../services/moderationConfigService/index.js';
import { addHashesToImageFields } from './hashImageFields.js';

const schema = [
  { name: 'text', type: 'STRING', required: false, container: null },
  { name: 'images', type: 'IMAGE', required: false, container: null },
  {
    name: 'profilePic',
    type: 'ARRAY',
    required: false,
    container: {
      containerType: 'ARRAY',
      keyScalarType: 'NUMBER',
      valueScalarType: 'IMAGE',
    },
  },
  { name: 'cover', type: 'IMAGE', required: false, container: null },
] as unknown as ItemType['schema'];

const HMAHashBankService = {
  listBanks: vi.fn(),
  hashContentFromUrl: vi.fn(),
  checkImageMatchWithDetails: vi.fn(),
};

describe('addHashesToImageFields', () => {
  beforeEach(() => {
    HMAHashBankService.listBanks.mockResolvedValue([
      { hma_name: 'hma_bank', name: 'Bank' },
    ]);
    HMAHashBankService.hashContentFromUrl.mockResolvedValue({ pdq: 'abc' });
    HMAHashBankService.checkImageMatchWithDetails.mockResolvedValue({
      matchedBanks: ['hma_bank'],
    });
  });

  const run = async (data: { [key: string]: unknown }) => {
    await addHashesToImageFields({
      itemType: { schema },
      data,
      orgId: 'org',
      HMAHashBankService,
    });
    return data;
  };

  it('hashes an array Image field not named `images`', async () => {
    const data = await run({ profilePic: [{ url: 'https://x.test/a.png' }] });
    expect(data.profilePic).toEqual([
      {
        url: 'https://x.test/a.png',
        hashes: { pdq: 'abc' },
        matchedBanks: ['Bank'],
      },
    ]);
  });

  it('hashes a singular Image field, keeping it a single object', async () => {
    const data = await run({ images: { url: 'https://x.test/a.png' } });
    expect(data.images).toEqual({
      url: 'https://x.test/a.png',
      hashes: { pdq: 'abc' },
      matchedBanks: ['Bank'],
    });
  });

  it('hashes every Image field and leaves other fields alone', async () => {
    const data = await run({
      text: 'hi',
      cover: { url: 'https://x.test/c.png' },
      profilePic: [{ url: 'https://x.test/a.png' }],
    });
    expect(data.text).toBe('hi');
    expect(data.cover).toMatchObject({ hashes: { pdq: 'abc' } });
    expect(HMAHashBankService.hashContentFromUrl).toHaveBeenCalledTimes(2);
  });
});
