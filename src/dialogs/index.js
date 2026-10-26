// Dialogs shared by several screens.
export {
  supplementText, openBookingDialog, openExtendDialog, openCancelReservationDialog,
  openConsumptionDialog, openQuickPayReservation, quickStartReservation, quickFinishReservation, openFinishDialog, openCorrectDepartureDialog, correctableOverrun,
  quickUpdatePartySize, quickChangeRoom, memberRoomEligibility,
  sendWhatsAppText,
} from './reservationDialogs.jsx';
export {
  openPaymentDialog, openRefundDialog, cancelChargeDialog, canRefund,
  openRechargeDialog, openOutsideMealDialog, openCancelRechargeDialog, openCancelMealDialog, sendRenewalWhatsApp,
} from './moneyDialogs.jsx';
export {
  openMemberDialog, openSubscriptionDialog, openCardDialog, openAdjustCreditDialog,
  openDeactivateMemberDialog, openReactivateMemberDialog,
} from './memberDialogs.jsx';
