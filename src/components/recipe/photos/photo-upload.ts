// Client side of photo upload: pre-check (speed only, the server is authoritative), error-code
// mapping and an XMLHttpRequest wrapper (fetch cannot report upload progress). No React here.

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_COUNT = 10;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type UploadErrorKey =
  | 'tooLarge'
  | 'unsupported'
  | 'invalid'
  | 'tooManyPixels'
  | 'limit'
  | 'busy'
  | 'forbidden'
  | 'network';

export type UploadError = { key: UploadErrorKey; retry: boolean };

export type PickedFile = { name: string; type: string; size: number };

/** The image type to send: the declared one when allowed, else guessed from the extension. */
export function contentTypeFor(file: PickedFile): string | null {
  const declared = file.type.toLowerCase();
  if (Object.values(EXT_TYPES).includes(declared)) return declared;
  if (declared !== '') return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? null;
}

/** Fast local rejection; null means "send it and let the server decide". */
export function precheck(file: PickedFile): UploadError | null {
  if (file.size > PHOTO_MAX_BYTES) return { key: 'tooLarge', retry: false };
  if (contentTypeFor(file) === null) return { key: 'unsupported', retry: false };
  return null;
}

const CODE_KEYS: Record<string, UploadErrorKey> = {
  unsupported_type: 'unsupported',
  invalid_image: 'invalid',
  empty_file: 'invalid',
  too_many_pixels: 'tooManyPixels',
  photo_limit: 'limit',
};

/** Map a failed response (status 0 = no response) to one message key and a retry flag. */
export function uploadErrorFor(status: number, body: unknown): UploadError {
  if (status === 413) return { key: 'tooLarge', retry: false };
  if (status === 415) return { key: 'unsupported', retry: false };
  if (status === 422) {
    const errors = (body as { errors?: Array<{ code?: unknown }> } | null)?.errors;
    const code = errors?.[0]?.code;
    return { key: (typeof code === 'string' && CODE_KEYS[code]) || 'invalid', retry: false };
  }
  if (status === 429 || status === 503) return { key: 'busy', retry: true };
  if (status === 401 || status === 403 || status === 404) return { key: 'forbidden', retry: false };
  return { key: 'network', retry: true };
}

export type UploadedPhoto = { id: string; width: number; height: number; is_cover: boolean };
export type UploadResult = { ok: true; photo: UploadedPhoto } | ({ ok: false } & UploadError);

/** POST the raw bytes (the request body IS the image). Never throws. */
export function uploadPhoto(
  recipeId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const type = contentTypeFor(file);
    if (type === null) return resolve({ ok: false, key: 'unsupported', retry: false });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/recipes/${encodeURIComponent(recipeId)}/photos`);
    xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => resolve({ ok: false, ...uploadErrorFor(0, null) });
    xhr.ontimeout = xhr.onerror;
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status === 201 && body && typeof (body as UploadedPhoto).id === 'string') {
        resolve({ ok: true, photo: body as UploadedPhoto });
      } else {
        resolve({ ok: false, ...uploadErrorFor(xhr.status, body) });
      }
    };
    xhr.send(file);
  });
}
