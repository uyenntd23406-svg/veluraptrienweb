/**
 * Order State Machine Constants & Helpers (Angular admin-ng)
 * Nguồn sự thật: KAN-59 (Order State Machine), KAN-60 (Action Specification), KAN-63 (FSD)
 */

export const ORDER_STATES = {
  PENDING: 'pending',
  WAITING_PAYMENT: 'waiting_payment',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPING: 'shipping',
  DELIVERED: 'delivered',
  DELIVERY_FAILED: 'delivery_failed',
  CANCELLED: 'cancelled',
} as const;

export type OrderState = (typeof ORDER_STATES)[keyof typeof ORDER_STATES];

export const ORDER_STATE_LABELS: Record<string, string> = {
  [ORDER_STATES.PENDING]: 'Chờ xác nhận',
  [ORDER_STATES.WAITING_PAYMENT]: 'Chờ thanh toán',
  [ORDER_STATES.CONFIRMED]: 'Đã xác nhận',
  [ORDER_STATES.PROCESSING]: 'Đang chuẩn bị hàng',
  preparing: 'Đang chuẩn bị hàng',
  [ORDER_STATES.SHIPPING]: 'Đang giao hàng',
  [ORDER_STATES.DELIVERED]: 'Giao thành công',
  completed: 'Giao thành công',
  [ORDER_STATES.DELIVERY_FAILED]: 'Giao không thành công',
  failed_delivery: 'Giao không thành công',
  [ORDER_STATES.CANCELLED]: 'Đã hủy',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: 'Đã thanh toán',
  failed: 'Thanh toán thất bại',
  pending: 'Chờ xử lý',
  refunded: 'Đã hoàn tiền',
  refund_pending: 'Chờ hoàn tiền',
  discrepancy: 'Cần đối soát',
};

export const CANCEL_REASONS = [
  { value: 'CUSTOMER_REQUEST', label: 'Khách hàng yêu cầu hủy' },
  { value: 'OUT_OF_STOCK', label: 'Hết hàng trong kho' },
  { value: 'PAYMENT_TIMEOUT', label: 'Quá thời hạn thanh toán' },
  { value: 'UNABLE_TO_CONTACT', label: 'Không thể liên hệ khách hàng' },
  { value: 'INCORRECT_INFO', label: 'Thông tin giao hàng không hợp lệ' },
  { value: 'OTHER', label: 'Lý do khác' },
];

export const CALL_RESULTS = [
  { value: 'CONTACTED', label: 'Liên hệ được' },
  { value: 'NO_ANSWER', label: 'Không nghe máy' },
  { value: 'CANCEL_REQUESTED', label: 'Khách yêu cầu hủy' },
];

export interface PriorityTag {
  code: string;
  label: string;
  type: 'danger' | 'warning';
}

export function getOrderPriorityTag(order: { status?: string; payment_method?: string; payment_type?: string; total_amount?: number; order_date?: string; created_at?: string }): PriorityTag | null {
  if (order.status !== ORDER_STATES.PENDING) return null;
  const isCod = order.payment_method === 'COD' || order.payment_type === 'COD';
  const amount = Number(order.total_amount || 0);

  if (!isCod || amount < 1000000) return null;

  const createdAt = new Date(order.order_date || order.created_at || Date.now()).getTime();
  const now = Date.now();
  const hoursPassed = (now - createdAt) / (1000 * 60 * 60);

  if (hoursPassed >= 24) {
    return { code: 'REVIEW_OVERDUE', label: 'CẦN XỬ LÝ GẤP (>24H)', type: 'danger' };
  }
  return { code: 'PRIORITY_REVIEW', label: 'ƯU TIÊN RÀ SOÁT (≥1M)', type: 'warning' };
}

export function isOrderAdmin(roleCode: string | null | undefined): boolean {
  return roleCode === 'super_admin' || roleCode === 'admin_operator_donhang';
}

export interface AvailableAction {
  id: string;
  label: string;
  icon: string;
  variant: 'primary' | 'secondary' | 'warning' | 'danger';
  modalType: string;
  hint: string;
  disabled?: boolean;
  disabledHint?: string;
}

export function getAvailableActions(
  order: {
    status?: string;
    payment_method?: string;
    payment_type?: string;
    tracking_code?: string | null;
    is_handed_over?: boolean;
    handed_over_at?: string | null;
  },
  roleCode: string | null | undefined
): AvailableAction[] {
  if (!isOrderAdmin(roleCode)) {
    return [];
  }

  const actions: AvailableAction[] = [];
  let status = order.status || '';
  if (status === 'preparing') status = ORDER_STATES.PROCESSING;
  if (status === 'failed_delivery') status = ORDER_STATES.DELIVERY_FAILED;
  if (status === 'completed') status = ORDER_STATES.DELIVERED;
  const isCod = order.payment_method === 'COD' || order.payment_type === 'COD';
  const trackingCode = (order.tracking_code || '').trim();
  const isHandedOver = Boolean(order.is_handed_over || order.handed_over_at);

  switch (status) {
    case ORDER_STATES.PENDING:
      actions.push({
        id: 'call_confirm',
        label: 'Gọi điện xác nhận',
        icon: 'phone',
        variant: 'secondary',
        modalType: 'call_confirm',
        hint: 'Ghi nhận kết quả liên hệ (không tự đổi trạng thái)',
      });

      if (isCod) {
        actions.push({
          id: 'confirm_cod',
          label: 'Xác nhận đơn COD',
          icon: 'check-circle',
          variant: 'primary',
          modalType: 'confirm_cod',
          hint: 'Chuyển trạng thái đơn sang Đã xác nhận (confirmed)',
        });
      }

      actions.push({
        id: 'cancel_order',
        label: 'Hủy đơn',
        icon: 'x-circle',
        variant: 'danger',
        modalType: 'cancel_order',
        hint: 'Hủy đơn hàng và chuyển sang Đã hủy (cancelled)',
      });
      break;

    case ORDER_STATES.WAITING_PAYMENT:
      actions.push({
        id: 'cancel_order',
        label: 'Hủy đơn',
        icon: 'x-circle',
        variant: 'danger',
        modalType: 'cancel_order',
        hint: 'Hủy đơn hàng chưa thanh toán',
      });
      break;

    case ORDER_STATES.CONFIRMED:
      actions.push({
        id: 'start_processing',
        label: 'Bắt đầu chuẩn bị hàng',
        icon: 'box',
        variant: 'primary',
        modalType: 'start_processing',
        hint: 'Chuyển đơn sang Đang chuẩn bị hàng (processing)',
      });

      actions.push({
        id: 'cancel_order',
        label: 'Hủy đơn',
        icon: 'x-circle',
        variant: 'danger',
        modalType: 'cancel_order',
        hint: 'Hủy đơn trước khi bàn giao cho ĐVVC',
      });
      break;

    case ORDER_STATES.PROCESSING:
      actions.push({
        id: 'record_shortage',
        label: 'Ghi nhận thiếu hàng',
        icon: 'alert-triangle',
        variant: 'warning',
        modalType: 'record_shortage',
        hint: 'Lưu tình trạng thiếu hàng & nội dung liên hệ khách',
      });

      actions.push({
        id: 'update_shipping_code',
        label: trackingCode ? 'Cập nhật mã vận đơn' : 'Tạo mã vận đơn',
        icon: 'file-text',
        variant: 'secondary',
        modalType: 'update_shipping_code',
        hint: 'Tạo hoặc cập nhật thông tin mã vận đơn',
      });

      actions.push({
        id: 'handover_shipping',
        label: 'Xác nhận bàn giao ĐVVC',
        icon: 'truck',
        variant: 'primary',
        modalType: 'handover_shipping',
        disabled: !trackingCode,
        disabledHint: 'Yêu cầu phải tạo mã vận đơn trước khi bàn giao thực tế',
        hint: 'Chuyển trạng thái đơn sang Đang giao hàng (shipping)',
      });

      if (!isHandedOver) {
        actions.push({
          id: 'cancel_order',
          label: 'Hủy đơn',
          icon: 'x-circle',
          variant: 'danger',
          modalType: 'cancel_order',
          hint: trackingCode ? 'Hủy đơn (Mã vận đơn sẽ bị vô hiệu hóa)' : 'Hủy đơn trước bàn giao',
        });
      }
      break;

    case ORDER_STATES.SHIPPING:
      actions.push({
        id: 'note_carrier',
        label: 'Ghi chú liên hệ ĐVVC',
        icon: 'message-square',
        variant: 'secondary',
        modalType: 'note_carrier',
        hint: 'Ghi nhận thông tin làm việc với bên vận chuyển',
      });

      actions.push({
        id: 'update_tracking',
        label: 'Cập nhật tracking',
        icon: 'map-pin',
        variant: 'secondary',
        modalType: 'update_tracking',
        hint: 'Cập nhật thông tin hành trình giao hàng',
      });
      break;

    case ORDER_STATES.DELIVERY_FAILED:
      break;

    case ORDER_STATES.DELIVERED:
    case ORDER_STATES.CANCELLED:
    default:
      break;
  }

  return actions;
}
