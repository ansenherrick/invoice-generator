import multer from "multer";

const imageFilter: multer.Options["fileFilter"] = (_request, file, callback) => {
  if (!file.mimetype.startsWith("image/")) {
    callback(new Error("Only image uploads are supported."));
    return;
  }

  callback(null, true);
};

const baseUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: imageFilter,
});

export const logoUpload = baseUpload;
export const signatureUpload = baseUpload;
