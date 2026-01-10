const accountInfo = document.getElementById("accountInfo");
const totalMinutesEl = document.getElementById("totalMinutes");

export function updateAccount(userData){
  accountInfo.innerHTML = `
    <div>Name: ${userData?.firstName||""} ${userData?.lastName||""}</div>
    <div>Grade: ${userData?.grade||""}</div>
    <div>Total Earned: ${userData?.totalEarned||0}</div>
  `;
  totalMinutesEl.textContent = userData?.totalMinutes || 0;
}
