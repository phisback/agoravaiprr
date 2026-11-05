export function isGifProfileBanner(banner) {
  const imageData = banner?.imageBuffer;
  const hasGifSignature = imageData?.length >= 3
    && Buffer.from(imageData).subarray(0, 3).toString('ascii') === 'GIF';
  return hasGifSignature || /\.gif(?:[?#].*)?$/i.test(banner?.imageUrl ?? '');
}
