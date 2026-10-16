import { useTranslation } from 'react-i18next';
import { StitchVueIcon } from '../../shared/icons/StitchVueIcon';
import styles from './GalleryScrollJumpButton.module.scss';

type GalleryScrollJumpButtonProps = {
    pointUp: boolean;
    loading?: boolean;
    onJump: (toTop: boolean) => void;
};

export function GalleryScrollJumpButton({
    pointUp,
    loading = false,
    onJump,
}: GalleryScrollJumpButtonProps) {
    const { t } = useTranslation();
    const label = pointUp
        ? t('gallery.scrollToTopAria')
        : t('gallery.scrollToBottomAria');
    return (
        <button
            type="button"
            className={styles.button}
            data-direction={pointUp ? 'up' : 'down'}
            data-loading={loading ? 'true' : undefined}
            aria-busy={loading || undefined}
            aria-label={label}
            onClick={() => onJump(pointUp)}
        >
            <span
                className={styles.loaderRing}
                aria-hidden
            />
            <StitchVueIcon
                name="navigation-up"
                className={styles.icon}
            />
        </button>
    );
}
