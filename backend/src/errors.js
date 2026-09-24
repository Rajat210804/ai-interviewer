// An error whose message is safe to show to the user. Anything else becomes a generic 500.
export class AppError extends Error {
  constructor(status, userMessage, detail) {
    super(detail || userMessage);
    this.status = status;
    this.userMessage = userMessage;
  }
}

export function errorHandler(err, req, res, _next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large. Please upload a file under 5 MB.' });
  }
  if (err instanceof AppError) {
    if (err.status >= 500) console.error(`[${req.method} ${req.path}]`, err.message);
    return res.status(err.status).json({ error: err.userMessage });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request could not be read. Please try again.' });
  }
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
