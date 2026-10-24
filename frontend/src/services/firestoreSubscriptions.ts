import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  type Unsubscribe 
} from 'firebase/firestore';
import { firestore } from '../config/firebase';

const ORG_ID = 'org_triwiz_01';

export const firestoreSubscriptions = {
  /**
   * Real-time subscription to inventory stock aggregates
   */
  subscribeToInventory(
    warehouseId: string, 
    onUpdate: (items: any[]) => void, 
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const invRef = collection(firestore, 'inventory');
      let q = query(invRef, where('org_id', '==', ORG_ID));
      if (warehouseId && warehouseId !== 'all') {
        q = query(invRef, where('org_id', '==', ORG_ID), where('warehouse_id', '==', warehouseId));
      }

      return onSnapshot(
        q,
        (snapshot) => {
          const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          onUpdate(items);
        },
        (error) => {
          console.warn('[Firestore] Inventory subscription warning:', error);
          if (onError) onError(error);
        }
      );
    } catch (err: any) {
      console.warn('[Firestore] Real-time inventory subscription fallback:', err);
      return () => {};
    }
  },

  /**
   * Real-time subscription to FEFO inventory batches
   */
  subscribeToBatches(
    warehouseId: string,
    onUpdate: (batches: any[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const batchRef = collection(firestore, 'inventory_batches');
      let q = query(batchRef, where('org_id', '==', ORG_ID));
      if (warehouseId && warehouseId !== 'all') {
        q = query(batchRef, where('org_id', '==', ORG_ID), where('warehouse_id', '==', warehouseId));
      }

      return onSnapshot(
        q,
        (snapshot) => {
          const batches = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          onUpdate(batches);
        },
        (error) => {
          console.warn('[Firestore] Batches subscription warning:', error);
          if (onError) onError(error);
        }
      );
    } catch (err: any) {
      console.warn('[Firestore] Real-time batches subscription fallback:', err);
      return () => {};
    }
  },

  /**
   * Real-time subscription to IoT cold-chain alerts
   */
  subscribeToAlerts(
    onUpdate: (alerts: any[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const alertsRef = collection(firestore, 'alerts');
      const q = query(
        alertsRef,
        where('org_id', '==', ORG_ID),
        orderBy('timestamp', 'desc')
      );

      return onSnapshot(
        q,
        (snapshot) => {
          const alerts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          onUpdate(alerts);
        },
        (error) => {
          console.warn('[Firestore] Alerts subscription warning:', error);
          if (onError) onError(error);
        }
      );
    } catch (err: any) {
      console.warn('[Firestore] Real-time alerts subscription fallback:', err);
      return () => {};
    }
  },

  /**
   * Real-time subscription to Inter-Warehouse Transfers
   */
  subscribeToTransfers(
    onUpdate: (transfers: any[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const trfRef = collection(firestore, 'transfers');
      const q = query(
        trfRef,
        where('org_id', '==', ORG_ID),
        orderBy('created_at', 'desc')
      );

      return onSnapshot(
        q,
        (snapshot) => {
          const transfers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          onUpdate(transfers);
        },
        (error) => {
          console.warn('[Firestore] Transfers subscription warning:', error);
          if (onError) onError(error);
        }
      );
    } catch (err: any) {
      console.warn('[Firestore] Real-time transfers subscription fallback:', err);
      return () => {};
    }
  },

  /**
   * Real-time subscription to Healthcare Facility Orders
   */
  subscribeToOrders(
    onUpdate: (orders: any[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const ordersRef = collection(firestore, 'orders');
      const q = query(
        ordersRef,
        where('org_id', '==', ORG_ID),
        orderBy('created_at', 'desc')
      );

      return onSnapshot(
        q,
        (snapshot) => {
          const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          onUpdate(orders);
        },
        (error) => {
          console.warn('[Firestore] Orders subscription warning:', error);
          if (onError) onError(error);
        }
      );
    } catch (err: any) {
      console.warn('[Firestore] Real-time orders subscription fallback:', err);
      return () => {};
    }
  },
};
