const avatarSize = 384;

export async function encodeAvatar(file: File) {
  if (file.size === 0 || file.size > 20 * 1024 * 1024) {
    throw new Error('Escolha uma foto de até 20 MB.');
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('Não foi possível abrir a imagem. Tente uma foto em JPEG, PNG ou WebP.');
    }
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    if (!edge) throw new Error('A imagem selecionada está vazia.');
    const canvas = document.createElement('canvas');
    canvas.width = avatarSize;
    canvas.height = avatarSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto.');
    context.fillStyle = '#e8eee7';
    context.fillRect(0, 0, avatarSize, avatarSize);
    context.drawImage(image,
      (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge,
      0, 0, avatarSize, avatarSize);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Não foi possível salvar a foto.'));
      }, 'image/jpeg', 0.86);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
