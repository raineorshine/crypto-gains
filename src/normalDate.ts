// convert d.m.y date (e.g. 18.06.2016 15:14 0) to normalized y-m-d hh:mm:ss
const normalDate = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`

export default normalDate
