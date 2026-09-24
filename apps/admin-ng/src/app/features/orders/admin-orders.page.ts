import { Component, computed, inject, signal } from '@angular/core';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AdminApiService, AdminAuditRow, AdminOrderPayment, AdminOrderRow } from '../../core/admin-api.service';
import { adminErrorMessage, adminListCount, adminListRows, adminOffset, adminRangeLabel } from '../../core/admin-http';
import { AdminSessionService } from '../../core/admin-session.service';
import { AdminEmptyState } from '../../shared/admin-empty-state';
import { AdminIcon } from '../../shared/admin-icon';
import { AdminPagination } from '../../shared/admin-pagination';
import {
  CALL_RESULTS,
  CANCEL_REASONS,
  ORDER_STATE_LABELS,
  ORDER_STATES,
  PAYMENT_STATUS_LABELS,
  AvailableAction,
  PriorityTag,
  getAvailableActions,
  getOrderPriorityTag,
  isOrderAdmin,
} from './order-constants';

type OrderTab = 'all' | 'pending' | 'active_processing' | 'attention' | 'payment' | 'cancelled' | 'logs';

@Component({
  selector: 'app-admin-orders-page',
  imports: [AdminEmptyState, AdminIcon, AdminPagination],
  templateUrl: './admin-orders.page.html',
})
export class AdminOrdersPage {
  private readonly api = inject(AdminApiService);
  readonly session = inject(AdminSessionService);

  readonly tab = signal<OrderTab>('all');
  readonly query = signal('');
  readonly status = signal('');
  readonly paymentMethod = signal('');
  readonly from = signal('');
  readonly rows = signal<AdminOrderRow[]>([]);
  readonly count = signal(0);
  readonly pendingCount = signal(0);
  readonly processingCount = signal(0);
  readonly activeProcessingCount = signal(0);
  readonly cancelledCount = signal(0);
  readonly paymentErrorCount = signal(0);
  readonly loadError = signal<string | null>(null);
  readonly loading = signal(true);
  readonly page = signal(1);
  readonly pageSize = 10;
  readonly selected = signal<AdminOrderRow | null>(null);
  readonly selectedOrderLogs = signal<AdminAuditRow[]>([]);

  // Modal Action Signals
  readonly activeModalType = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly submittingAction = signal(false);

  // Form Field Signals
  readonly actionNote = signal('');
  readonly actionReason = signal('CUSTOMER_REQUEST');
  readonly callResultInput = signal('CONTACTED');
  readonly shortageTextInput = signal('');
  readonly trackingCodeInput = signal('');
  readonly carrierTextInput = signal('');
  readonly trackingInfoInput = signal('');
  readonly physicalHandoverChecked = signal(false);

  // Audit logs
  readonly logs = signal<AdminAuditRow[]>([]);
  readonly logsPage = signal(1);
  readonly logsCount = signal(0);
  readonly menuId = signal<string | null>(null);

  // Constants for template
  readonly orderStatesMap = ORDER_STATE_LABELS;
  readonly cancelReasonsList = CANCEL_REASONS;
  readonly callResultsList = CALL_RESULTS;

  // Computed Properties & Role Checks
  readonly roleCode = computed(() => this.session.session()?.roleCode || 'admin_operator_donhang');
  readonly isOrderAdminUser = computed(() => isOrderAdmin(this.roleCode()));

  readonly attentionCount = computed(() => this.pendingCount() + this.paymentErrorCount());
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.count() / this.pageSize)));
  readonly rangeLabel = computed(() => adminRangeLabel(this.count(), this.page(), this.pageSize, 'đơn hàng'));
  readonly selectedItems = computed(() => this.selected()?.items || []);
  readonly logPageCount = computed(() => Math.max(1, Math.ceil(this.logsCount() / this.pageSize)));
  readonly logRangeLabel = computed(() => adminRangeLabel(this.logsCount(), this.logsPage(), this.pageSize, 'nhật ký'));

  readonly currentAvailableActions = computed<AvailableAction[]>(() => {
    const order = this.selected();
    if (!order) return [];
    return getAvailableActions(order, this.roleCode());
  });

  readonly currentPriorityTag = computed<PriorityTag | null>(() => {
    const order = this.selected();
    if (!order) return null;
    return getOrderPriorityTag(order);
  });

  constructor() {
    this.reload();
  }

  setTab(tab: OrderTab): void {
    this.tab.set(tab);
    this.page.set(1);
    this.menuId.set(null);
    if (tab === 'logs') {
      this.loadLogs();
      return;
    }
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const tab = this.tab();
    let statusFilter = this.status();

    if (tab === 'pending') {
      statusFilter = ORDER_STATES.PENDING;
    } else if (tab === 'cancelled') {
      statusFilter = ORDER_STATES.CANCELLED;
    } else if (tab === 'attention') {
      statusFilter = statusFilter || ORDER_STATES.PENDING;
    }

    this.api
      .listOrders({
        q: this.query(),
        status: statusFilter,
        paymentMethod: this.paymentMethod(),
        from: this.from(),
        limit: String(this.pageSize),
        offset: adminOffset(this.page(), this.pageSize),
      })
      .pipe(
        catchError((error: unknown) => {
          this.loadError.set(adminErrorMessage(error, 'Không thể tải danh sách đơn hàng'));
          return of({ rows: [] as AdminOrderRow[], count: 0 });
        }),
      )
      .subscribe((payload) => {
        let rows = adminListRows(payload);
        if (tab === 'active_processing') {
          rows = rows.filter((r) => r.status === ORDER_STATES.PROCESSING || r.status === ORDER_STATES.SHIPPING || r.status === ORDER_STATES.CONFIRMED);
        } else if (tab === 'payment') {
          rows = rows.filter((r) => this.isPaymentError(r));
        }
        this.rows.set(rows);
        this.count.set(tab === 'payment' || tab === 'active_processing' ? rows.length : adminListCount(payload));
        this.paymentErrorCount.set(rows.filter((r) => this.isPaymentError(r)).length);
        this.loading.set(false);
      });

    this.api.listOrders({ status: ORDER_STATES.PENDING, limit: '1' }).subscribe({
      next: (payload) => this.pendingCount.set(adminListCount(payload)),
    });
    this.api.listOrders({ status: ORDER_STATES.CANCELLED, limit: '1' }).subscribe({
      next: (payload) => this.cancelledCount.set(adminListCount(payload)),
    });
    this.api.listOrders({ limit: '100' }).subscribe({
      next: (payload) => {
        const allRows = adminListRows(payload);
        const active = allRows.filter((r) => r.status === ORDER_STATES.PROCESSING || r.status === ORDER_STATES.SHIPPING || r.status === ORDER_STATES.CONFIRMED);
        this.activeProcessingCount.set(active.length);
      },
    });
  }

  applyFilters(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    this.query.set((form.elements.namedItem('q') as HTMLInputElement | null)?.value.trim() || '');
    this.status.set((form.elements.namedItem('status') as HTMLSelectElement | null)?.value || '');
    this.paymentMethod.set((form.elements.namedItem('paymentMethod') as HTMLSelectElement | null)?.value || '');
    this.from.set((form.elements.namedItem('from') as HTMLInputElement | null)?.value || '');
    this.page.set(1);
    this.reload();
  }

  resetFilters(event: Event): void {
    event.preventDefault();
    this.query.set('');
    this.status.set('');
    this.paymentMethod.set('');
    this.from.set('');
    this.page.set(1);
    this.reload();
  }

  goPage(page: number): void {
    this.page.set(Math.min(this.totalPages(), Math.max(1, page)));
    this.reload();
  }

  goLogsPage(page: number): void {
    this.logsPage.set(Math.min(this.logPageCount(), Math.max(1, page)));
    this.loadLogs();
  }

  toggleMenu(orderId: string): void {
    this.menuId.update((current) => (current === orderId ? null : orderId));
  }

  openDetail(orderId: string): void {
    this.menuId.set(null);
    this.api.getOrder(orderId).subscribe({
      next: (order) => {
        this.selected.set(order);
        this.loadSelectedOrderLogs(order.order_id);
      },
      error: (error: unknown) => this.loadError.set(adminErrorMessage(error)),
    });
  }

  private loadSelectedOrderLogs(orderId: string): void {
    this.api.listAuditLogs({ targetId: orderId, limit: '20' }).subscribe({
      next: (payload) => this.selectedOrderLogs.set(adminListRows(payload)),
      error: () => this.selectedOrderLogs.set([]),
    });
  }

  closeOverlays(): void {
    this.selected.set(null);
    this.selectedOrderLogs.set([]);
    this.activeModalType.set(null);
    this.actionError.set(null);
    this.submittingAction.set(false);
  }

  openActionModal(modalType: string, orderId?: string): void {
    if (orderId) {
      const order = this.rows().find((r) => r.order_id === orderId) || null;
      if (order) this.selected.set(order);
    }
    const currentOrder = this.selected();
    if (!currentOrder) return;

    this.activeModalType.set(modalType);
    this.actionError.set(null);
    this.actionNote.set('');
    this.callResultInput.set('CONTACTED');
    this.actionReason.set('CUSTOMER_REQUEST');
    this.shortageTextInput.set('');
    this.trackingCodeInput.set(currentOrder.tracking_code || '');
    this.carrierTextInput.set('');
    this.trackingInfoInput.set('');
    this.physicalHandoverChecked.set(false);
    this.menuId.set(null);
  }

  closeModalOnly(): void {
    this.activeModalType.set(null);
    this.actionError.set(null);
  }

  submitActionModal(event: Event): void {
    event.preventDefault();
    const order = this.selected();
    const modalType = this.activeModalType();
    if (!order || !modalType) return;

    const note = this.actionNote().trim();
    if (!note || note.length < 5) {
      this.actionError.set('Ghi chú xử lý là bắt buộc và phải có ít nhất 5 ký tự!');
      return;
    }

    if (modalType === 'handover_shipping') {
      if (!order.tracking_code) {
        this.actionError.set('Đơn hàng chưa có mã vận đơn. Vui lòng tạo mã vận đơn trước!');
        return;
      }
      if (!this.physicalHandoverChecked()) {
        this.actionError.set('Vui lòng đánh dấu chọn xác nhận đã bàn giao hàng thực tế cho đơn vị vận chuyển!');
        return;
      }
    }

    this.submittingAction.set(true);
    this.actionError.set(null);

    let request$;

    switch (modalType) {
      case 'call_confirm':
        request$ = this.api.changeOrderStatus(order.order_id, {
          action: 'CALL_CONFIRM',
          callResult: this.callResultInput(),
          reason: note,
          expectedVersion: order.version,
        } as any);
        break;

      case 'confirm_cod':
        request$ = this.api.changeOrderStatus(order.order_id, {
          status: ORDER_STATES.CONFIRMED,
          reason: note,
          expectedVersion: order.version,
        });
        break;

      case 'start_processing':
        request$ = this.api.changeOrderStatus(order.order_id, {
          status: ORDER_STATES.PROCESSING,
          reason: note,
          expectedVersion: order.version,
        });
        break;

      case 'record_shortage':
        request$ = this.api.changeOrderStatus(order.order_id, {
          action: 'RECORD_SHORTAGE',
          shortageDetails: this.shortageTextInput(),
          reason: note,
          expectedVersion: order.version,
        } as any);
        break;

      case 'update_shipping_code':
        request$ = this.api.changeOrderStatus(order.order_id, {
          action: 'UPDATE_TRACKING_CODE',
          trackingCode: this.trackingCodeInput(),
          reason: note,
          expectedVersion: order.version,
        } as any);
        break;

      case 'handover_shipping':
        if (!order.tracking_code) {
          this.actionError.set('Đơn hàng chưa có mã vận đơn. Vui lòng tạo mã vận đơn trước!');
          this.submittingAction.set(false);
          return;
        }
        request$ = this.api.changeOrderStatus(order.order_id, {
          status: ORDER_STATES.SHIPPING,
          trackingCode: order.tracking_code,
          reason: note,
          expectedVersion: order.version,
        });
        break;

      case 'note_carrier':
        request$ = this.api.changeOrderStatus(order.order_id, {
          action: 'NOTE_CARRIER',
          carrierNote: this.carrierTextInput(),
          reason: note,
          expectedVersion: order.version,
        } as any);
        break;

      case 'update_tracking':
        request$ = this.api.changeOrderStatus(order.order_id, {
          action: 'UPDATE_TRACKING_INFO',
          trackingInfo: this.trackingInfoInput(),
          reason: note,
          expectedVersion: order.version,
        } as any);
        break;

      case 'cancel_order':
        request$ = this.api.cancelOrder(order.order_id, {
          reason: `${this.actionReason()}: ${note}`,
          expectedVersion: order.version,
        });
        break;

      default:
        this.submittingAction.set(false);
        return;
    }

    request$.subscribe({
      next: () => {
        this.submittingAction.set(false);
        this.closeModalOnly();
        this.reload();
        if (this.selected()) {
          this.openDetail(order.order_id);
        }
      },
      error: (error: unknown) => {
        this.submittingAction.set(false);
        const errMsg = adminErrorMessage(error);
        if (errMsg.includes('VERSION') || errMsg.includes('version')) {
          this.actionError.set('Dữ liệu đơn hàng đã thay đổi ở nơi khác. Đang làm mới dữ liệu...');
          this.reload();
          this.openDetail(order.order_id);
        } else {
          this.actionError.set(errMsg);
        }
      },
    });
  }

  isPaymentError(order: AdminOrderRow): boolean {
    const payment = this.paymentOf(order);
    return payment?.payment_status === 'failed' || payment?.payment_status === 'discrepancy' || payment?.has_discrepancy === true;
  }

  needsAttention(order: AdminOrderRow): boolean {
    return order.status === ORDER_STATES.PENDING || order.status === ORDER_STATES.DELIVERY_FAILED || this.isPaymentError(order) || Boolean(getOrderPriorityTag(order));
  }

  paymentOf(order: AdminOrderRow): AdminOrderPayment | null {
    return Array.isArray(order.payments) ? order.payments[0] : null;
  }

  orderLabel(status: string | undefined): string {
    return ORDER_STATE_LABELS[status || ''] || status || '—';
  }

  paymentLabel(status: string | undefined): string {
    return PAYMENT_STATUS_LABELS[status || ''] || status || 'Chờ xử lý';
  }

  rowPriorityTag(order: AdminOrderRow): PriorityTag | null {
    return getOrderPriorityTag(order);
  }

  rowAvailableActions(order: AdminOrderRow): AvailableAction[] {
    return getAvailableActions(order, this.roleCode());
  }

  money(value: number | undefined): string {
    return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
  }

  lineTotal(unitPrice: number | undefined, quantity: number | undefined): string {
    return this.money(Number(unitPrice || 0) * Number(quantity || 0));
  }

  dateTime(value: string | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
  }

  exportCsv(): void {
    const rows = [
      ['order_id', 'order_date', 'status', 'shipping_name', 'shipping_phone', 'total_amount'],
      ...this.rows().map((order) => [order.order_id, order.order_date || '', order.status || '', order.shipping_name || '', order.shipping_phone || '', String(order.total_amount || 0)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `velura-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private loadLogs(): void {
    this.api.listAuditLogs({ module: 'orders', limit: String(this.pageSize), offset: adminOffset(this.logsPage(), this.pageSize) }).subscribe({
      next: (payload) => {
        this.logs.set(adminListRows(payload));
        this.logsCount.set(adminListCount(payload));
      },
      error: (error: unknown) => this.loadError.set(adminErrorMessage(error)),
    });
  }
}
