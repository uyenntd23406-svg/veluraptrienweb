import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CartLine, CartStore, GroupedCartItem } from '../../core/services/cart.store';
import { formatVnd, toPublicAsset } from '../../core/utils/money';
import { showToast } from '../../core/utils/toast';
import { useBodyClass } from '../../core/utils/body-class';
import { CatalogService } from '../../core/services/catalog.service';
import { AuthService } from '../../core/services/auth.service';
import { ProductSummary, ProductVariant } from '../../core/models/product.interface';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const ITEMS_PER_PAGE = 5;
const SELECTED_KEY = 'selected_cart_items';
const CHECKOUT_ITEMS_KEY = 'checkout_items';

type PageItem = { kind: 'page'; value: number } | { kind: 'dots'; value: number };

@Component({
  selector: 'app-cart-page',
  imports: [RouterLink],
  host: { class: 'page-cart', style: 'display:block' },
  templateUrl: './cart.page.html',
})
export class CartPage {
  private readonly cart = inject(CartStore);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);
  readonly products = signal<ProductSummary[]>([]);
  readonly stockLoading = signal(true);
  readonly stockError = signal('');

  readonly currentPage = signal(1);
  readonly selectedIds = signal<string[]>(this.readSelectedIds());
  private hadStoredSelection = sessionStorage.getItem(SELECTED_KEY) !== null;
  readonly groupedItems = computed(() => this.cart.groupItems());
  readonly groupedCount = computed(() =>
    this.groupedItems().reduce((sum, item) => sum + item.quantity, 0),
  );
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.groupedItems().length / ITEMS_PER_PAGE)));
  readonly pagedItems = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * ITEMS_PER_PAGE;
    return this.groupedItems().slice(start, start + ITEMS_PER_PAGE);
  });
  readonly pageItems = computed<PageItem[]>(() => {
    const total = this.totalPages();
    const current = Math.min(this.currentPage(), total);
    const items: PageItem[] = [];
    for (let page = 1; page <= total; page += 1) {
      if (page === 1 || page === total || Math.abs(page - current) <= 1) {
        items.push({ kind: 'page', value: page });
      } else if (page === current - 2 || page === current + 2) {
        items.push({ kind: 'dots', value: page });
      }
    }
    return items;
  });
  readonly showPagination = computed(() => this.groupedItems().length > ITEMS_PER_PAGE);
  readonly selectedItems = computed(() => {
    const selected = new Set(this.selectedIds());
    return this.groupedItems().filter((item) => selected.has(item.variant_id));
  });
  readonly selectedSubtotal = computed(() =>
    this.selectedItems().reduce((sum, item) => sum + item.unit_price * item.quantity, 0),
  );
  readonly allSelected = computed(() => {
    const items = this.groupedItems();
    if (!items.length) {
      return false;
    }
    const selected = new Set(this.selectedIds());
    return items.every((item) => selected.has(item.variant_id));
  });

  constructor() {
    useBodyClass('page-cart');
    this.syncSelection(this.groupedItems());
    this.catalog.getProducts().pipe(takeUntilDestroyed()).subscribe({
      next: products => { this.products.set(products); this.stockLoading.set(false); },
      error: () => { this.stockLoading.set(false); this.stockError.set('Chưa tải được tồn kho. Vui lòng tải lại trang để kiểm tra trước khi thanh toán.'); },
    });
  }

  /** Offer actual variant pairs from the catalog, never inventing a size/color ID. */
  variants(item: GroupedCartItem): ProductVariant[] { return this.products().find(product => product.product_id === item.product_id)?.variants || []; }

  /** Available inventory excludes quantities already reserved by other orders. */
  stock(variant: ProductVariant): number { return Math.max(0, (variant.stock_quantity || 0) - (variant.reserved_quantity || 0)); }

  /** Explain unavailable variants and quantity conflicts beside the affected line. */
  stockIssue(item: GroupedCartItem): string {
    if (this.stockLoading()) return 'Đang kiểm tra tồn kho…';
    if (this.stockError()) return this.stockError();
    const lines = item.is_combo ? item.items || [] : [item];
    for (const line of lines) {
      const variant = this.products().find(product => product.product_id === line.product_id)?.variants?.find(row => row.variant_id === line.variant_id);
      if (!variant) return 'Chưa xác định được tồn kho của sản phẩm này.';
      if (!this.stock(variant)) return `Sản phẩm này vừa hết size ${line.size || 'đã chọn'} / ${line.color || ''}.`;
      if (line.quantity > this.stock(variant)) return `Số lượng vượt tồn kho. Chỉ còn ${this.stock(variant)} sản phẩm.`;
    }
    return '';
  }

  /** Change a catalog variant and merge matching cart rows without losing the selection. */
  changeVariant(item: GroupedCartItem, event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const variant = this.variants(item).find(row => row.variant_id === id);
    if (!variant || !this.stock(variant) || id === item.variant_id || item.is_combo) return;
    const selected = this.isSelected(item);
    const lines = this.cart.items().filter(line => line.variant_id !== item.variant_id || line.combo_id);
    const existing = lines.find(line => line.variant_id === id && !line.combo_id);
    if (existing) {
      this.cart.replaceItems(lines.map(line => line === existing ? { ...line, quantity: line.quantity + item.quantity } : line));
    } else {
      this.cart.replaceItems([...lines, { ...item, variant_id: id, size: variant.size, color: variant.color }]);
    }
    this.selectedIds.update(ids => [...new Set([...ids.filter(value => value !== item.variant_id), ...(selected ? [id] : [])])]);
    this.persistSelected(); this.clampPage();
  }

  /**
   * Formats a grouped cart line total.
   */
  lineTotal(item: GroupedCartItem): string {
    return formatVnd(item.unit_price * item.quantity) || '0 đ';
  }

  /**
   * Formats the selected-items subtotal used by the original summary card.
   */
  subtotalLabel(): string {
    return formatVnd(this.selectedSubtotal()) || '0 đ';
  }

  /**
   * Resolves a cart thumbnail for Angular public assets.
   */
  imageUrl(item: GroupedCartItem | CartLine): string {
    return toPublicAsset(item.product_image, '/assets/images/placeholder.jpg');
  }

  /**
   * Lists combo component names for the original "Gồm:" tag.
   */
  comboIncludes(item: GroupedCartItem): string {
    return (item.items || []).map((part) => part.product_name).join(' + ');
  }

  /**
   * Removes a variant line or combo set using the original cart payload key.
   */
  remove(item: GroupedCartItem): void {
    this.cart.removeItem(item.variant_id);
    this.selectedIds.update((ids) => ids.filter((id) => id !== item.variant_id));
    this.persistSelected();
    this.clampPage();
  }

  /**
   * Steps the original cart quantity control for a line or combo set.
   */
  changeQty(item: GroupedCartItem, delta: number): void {
    if (delta > 0 && this.stockIssue({ ...item, quantity: item.quantity + delta, items: item.items?.map(line => ({ ...line, quantity: line.quantity + delta })) })) {
      showToast('Không thể tăng số lượng vượt tồn kho.'); return;
    }
    this.cart.updateQty(item.variant_id, item.quantity + delta);
    this.clampPage();
  }

  /**
   * Toggles one grouped row in the original selected-items list.
   */
  toggleItem(item: GroupedCartItem, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = checked
      ? [...this.selectedIds().filter((id) => id !== item.variant_id), item.variant_id]
      : this.selectedIds().filter((id) => id !== item.variant_id);
    this.selectedIds.set(next);
    this.persistSelected();
  }

  /**
   * Selects or clears every grouped cart row.
   */
  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds.set(checked ? this.groupedItems().map((item) => item.variant_id) : []);
    this.persistSelected();
  }

  /**
   * Moves to a cart page like the original 5-item pager.
   */
  goToPage(page: number): void {
    const next = Math.min(Math.max(1, page), this.totalPages());
    this.currentPage.set(next);
    document.querySelector('.cart-header')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Starts checkout with the originally selected cart rows.
   */
  checkout(): void {
    const selected = this.selectedItems();
    if (!selected.length) {
      showToast('Vui lòng chọn ít nhất một sản phẩm để thanh toán.');
      return;
    }
    if (selected.some(item => this.stockIssue(item))) { showToast('Kiểm tra các sản phẩm được cảnh báo trước khi thanh toán.'); return; }
    sessionStorage.setItem(CHECKOUT_ITEMS_KEY, JSON.stringify(this.cart.expandGroupedItems(selected)));
    localStorage.removeItem('checkout_discount');
    localStorage.removeItem('checkout_voucher_id');
    localStorage.removeItem('checkout_voucher_code');
    void this.router.navigateByUrl(this.auth.isLoggedIn() ? '/checkout/user' : '/checkout/guest');
  }

  /**
   * Returns whether a grouped row is currently selected.
   */
  isSelected(item: GroupedCartItem): boolean {
    return this.selectedIds().includes(item.variant_id);
  }

  private clampPage(): void {
    const total = Math.max(1, Math.ceil(this.groupedItems().length / ITEMS_PER_PAGE));
    if (this.currentPage() > total) {
      this.currentPage.set(total);
    }
    this.syncSelection(this.groupedItems());
  }

  private syncSelection(items: GroupedCartItem[]): void {
    const valid = new Set(items.map((item) => item.variant_id));
    if (!this.hadStoredSelection) {
      this.selectedIds.set(items.map((item) => item.variant_id));
      this.persistSelected();
      return;
    }
    this.selectedIds.set(this.selectedIds().filter((id) => valid.has(id)));
    this.persistSelected();
  }

  private persistSelected(): void {
    sessionStorage.setItem(SELECTED_KEY, JSON.stringify(this.selectedIds()));
    this.hadStoredSelection = true;
  }

  private readSelectedIds(): string[] {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SELECTED_KEY) || '[]') as unknown;
      return Array.isArray(raw) ? raw.map((id) => String(id)) : [];
    } catch {
      return [];
    }
  }
}
