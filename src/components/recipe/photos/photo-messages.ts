import type { UploadErrorKey } from './photo-upload';

type T = (key: string, values?: Record<string, string | number>) => string;

/** One literal key per error so the catalog test can check every message exists. */
export function uploadErrorMessage(t: T, key: UploadErrorKey, name: string): string {
  switch (key) {
    case 'tooLarge':
      return t('photos.error.tooLarge', { name });
    case 'unsupported':
      return t('photos.error.unsupported', { name });
    case 'invalid':
      return t('photos.error.invalid', { name });
    case 'tooManyPixels':
      return t('photos.error.tooManyPixels', { name });
    case 'limit':
      return t('photos.error.limit', { name });
    case 'busy':
      return t('photos.error.busy', { name });
    case 'forbidden':
      return t('photos.error.forbidden', { name });
    case 'network':
      return t('photos.error.network', { name });
  }
}
