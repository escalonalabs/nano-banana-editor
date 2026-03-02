const {
  GoogleGenAI,
  RawReferenceImage,
  SubjectReferenceImage,
  MaskReferenceImage,
  MaskReferenceMode,
  SubjectReferenceType,
} = require('@google/genai');

class NanoBananaAdapter {
  constructor({ apiKey, disableRemote, model }) {
    this.disableRemote = disableRemote;
    this.model = model;
    this.ai = null;

    if (!disableRemote && apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  async harmonize({ targetBuffer, sourceBuffer, maskBuffer, promptDirectives, qualityMode }) {
    if (this.disableRemote || !this.ai) {
      return null;
    }

    try {
      const raw = new RawReferenceImage();
      raw.referenceImage = {
        imageBytes: targetBuffer.toString('base64'),
        mimeType: 'image/png',
      };

      const subject = new SubjectReferenceImage();
      subject.referenceImage = {
        imageBytes: sourceBuffer.toString('base64'),
        mimeType: 'image/png',
      };
      subject.config = {
        subjectType: SubjectReferenceType.SUBJECT_TYPE_DEFAULT,
      };

      const referenceImages = [raw, subject];

      if (maskBuffer) {
        const mask = new MaskReferenceImage();
        mask.referenceImage = {
          imageBytes: maskBuffer.toString('base64'),
          mimeType: 'image/png',
        };
        mask.config = {
          maskMode: MaskReferenceMode.MASK_MODE_USER_PROVIDED,
          maskDilation: qualityMode === 'preview' ? 0.01 : 0.03,
        };
        referenceImages.push(mask);
      }

      const response = await this.ai.models.editImage({
        model: this.model,
        prompt: promptDirectives,
        referenceImages,
        config: {
          numberOfImages: 1,
          includeRaiReason: true,
          outputMimeType: 'image/png',
        },
      });

      const bytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (!bytes) {
        return null;
      }

      return Buffer.from(bytes, 'base64');
    } catch (error) {
      return null;
    }
  }
}

module.exports = {
  NanoBananaAdapter,
};
