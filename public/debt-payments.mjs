// Monthly amounts are shown in account editors. The payoff engine retains
// its existing 26-paycheck annual allocation, including legacy saved amounts.
const money=value=>Math.round((Number(value)||0)*100)/100;
export function monthlyMinimum(card){
 return money(Number.isFinite(card?.monthlyMinimum)?card.monthlyMinimum:(Number(card?.min)||0)*26/12);
}
export function monthlyPaymentSettings(card,amount){
 const monthly=money(amount);
 return {monthlyMinimum:monthly,min:card&&monthly===monthlyMinimum(card)?card.min:money(monthly*12/26)};
}
