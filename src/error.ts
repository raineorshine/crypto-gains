/** Exits with an error code. */
const error = (...msg: unknown[]) => {
  console.error(...msg)
  process.exit(1)
}

export default error
