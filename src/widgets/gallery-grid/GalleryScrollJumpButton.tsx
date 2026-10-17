import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderThumbLoaderSnapshot } from '../../features/gallery/lib/thumbnails/folderThumbLoaderProgress.ts';
import { StitchVueIcon } from '../../shared/icons/StitchVueIcon';
import { CometProgressLoader } from './comet-loader/CometProgressLoader';
import styles from './GalleryScrollJumpButton.module.scss';

type GalleryScrollJumpButtonProps = {
    pointUp: boolean;
    loading?: boolean;
    canScroll?: boolean;
    sessionKey?: string;
    progressRef?: RefObject<FolderThumbLoaderSnapshot>;
    onJump: (toTop: boolean) => void;
};

export function GalleryScrollJumpButton({
    pointUp,
    loading = false,
    canScroll = false,
    sessionKey = '',
    progressRef,
    onJump,
}: GalleryScrollJumpButtonProps) {
    const { t } = useTranslation();
    const [hold, setHold] = useState(false);
    const onHoldChange = useCallback((next: boolean) => {
        setHold((current) => (current === next ? current : next));
    }, []);

    useEffect(() => {
        if (loading) {
            setHold(true);
        }
    }, [loading]);

    const visible = loading || canScroll || hold;
    const loaderActive = loading || hold;
    const label = pointUp
        ? t('gallery.scrollToTopAria')
        : t('gallery.scrollToBottomAria');

    if (!visible) {
        return null;
    }

    return (
        <button
            type="button"
            className={styles.button}
            data-direction={pointUp ? 'up' : 'down'}
            data-loading={loaderActive ? 'true' : undefined}
            aria-busy={loading || undefined}
            aria-label={label}
            onClick={() => onJump(pointUp)}
        >
            {progressRef && loaderActive ? (
                <CometProgressLoader
                    loading={loading}
                    sessionKey={sessionKey}
                    progressRef={progressRef}
                    onHoldChange={onHoldChange}
                />
            ) : null}
            <StitchVueIcon
                name="navigation-up"
                className={styles.icon}
            />
        </button>
    );
}
