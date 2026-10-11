import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { shellStrings } from '../strings.js';
import styles from './CapacityPanel.module.css';

export function CapacityPanel() {
  const capacityOpen = useWorkbenchStore((s) => s.capacityOpen);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);

  if (!capacityOpen) {
    return null;
  }

  return (
    <aside
      aria-label={shellStrings.capacity.ariaLabel}
      className={styles.capacityPanel}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{shellStrings.capacity.title}</h2>
        <button
          type="button"
          onClick={toggleCapacity}
          aria-label={shellStrings.titleBar.toggleCapacity}
          className={styles.closeButton}
        >
          <Icon name="close" size={12} weight={2.2} />
        </button>
      </div>

      <div className={styles.emptyContent}>
        <span className={styles.emptyTitle}>
          {shellStrings.capacity.emptyTitle}
        </span>
        <span className={styles.emptyDescription}>
          {shellStrings.capacity.emptyDescription}
        </span>
      </div>
    </aside>
  );
}
