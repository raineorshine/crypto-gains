/** Converts a dd.mm.yyyy date string (e.g. 18.06.2016 15:14 0) to a normalized yyyy-mm-dd hh:mm:ss date string. */
const normalDate = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`

export default normalDate
