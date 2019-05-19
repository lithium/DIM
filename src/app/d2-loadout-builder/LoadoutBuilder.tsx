import { UIViewInjectedProps } from '@uirouter/react';
import { DestinyClass } from 'bungie-api-ts/destiny2';
import { t } from 'app/i18next-t';
import _ from 'lodash';
import React from 'react';
import { connect } from 'react-redux';
import { DestinyAccount } from '../accounts/destiny-account.service';
import CharacterSelect from '../character-select/CharacterSelect';
import { Loading } from '../dim-ui/Loading';
import { D2StoresService } from '../inventory/d2-stores.service';
import { InventoryBucket } from '../inventory/inventory-buckets';
import { D2Item } from '../inventory/item-types';
import { DimStore, D2Store } from '../inventory/store-types';
import { RootState } from '../store/reducers';
import GeneratedSets from './generated-sets/GeneratedSets';
import { filterGeneratedSets } from './generated-sets/utils';
import { ArmorSet, LockedItemType, StatTypes, MinMax } from './types';
import { sortedStoresSelector, storesLoadedSelector, storesSelector } from '../inventory/reducer';
import { Subscription } from 'rxjs';
import { computeSets } from './process';
import { createSelector } from 'reselect';
import PageWithMenu from 'app/dim-ui/PageWithMenu';
import FilterBuilds from './generated-sets/FilterBuilds';
import LoadoutDrawer from 'app/loadout/LoadoutDrawer';
import { D2ManifestDefinitions } from 'app/destiny2/d2-definitions.service';
import SearchFilterInput from 'app/search/SearchFilterInput';
import {
  SearchConfig,
  SearchFilters,
  searchConfigSelector,
  searchFiltersConfigSelector
} from 'app/search/search-filters';
import memoizeOne from 'memoize-one';
import styles from './LoadoutBuilder.m.scss';
import LockArmorAndPerks from './LockArmorAndPerks';
import CollapsibleTitle from 'app/dim-ui/CollapsibleTitle';

interface ProvidedProps {
  account: DestinyAccount;
}

interface StoreProps {
  storesLoaded: boolean;
  stores: DimStore[];
  isPhonePortrait: boolean;
  items: Readonly<{
    [classType: number]: Readonly<{
      [bucketHash: number]: Readonly<{ [itemHash: number]: readonly D2Item[] }>;
    }>;
  }>;
  defs?: D2ManifestDefinitions;
  searchConfig: SearchConfig;
  filters: SearchFilters;
}

type Props = ProvidedProps & StoreProps;

interface State {
  requirePerks: boolean;
  lockedMap: Readonly<{ [bucketHash: number]: readonly LockedItemType[] }>;
  selectedStore?: DimStore;
  statFilters: Readonly<{ [statType in StatTypes]: MinMax }>;
  minimumPower: number;
  query: string;
  statOrder: StatTypes[];
}

function mapStateToProps() {
  const itemsSelector = createSelector(
    storesSelector,
    (stores) => {
      const items: {
        [classType: number]: { [bucketHash: number]: { [itemHash: number]: D2Item[] } };
      } = {};
      for (const store of stores) {
        for (const item of store.items) {
          if (
            !item ||
            !item.isDestiny2() ||
            !item.sockets ||
            // Armor and Ghosts
            (!item.bucket.inArmor && item.bucket.hash !== 4023194814)
          ) {
            continue;
          }
          for (const classType of item.classType === DestinyClass.Unknown
            ? [DestinyClass.Hunter, DestinyClass.Titan, DestinyClass.Warlock]
            : [item.classType]) {
            if (!items[classType]) {
              items[classType] = {};
            }
            if (!items[classType][item.bucket.hash]) {
              items[classType][item.bucket.hash] = {};
            }
            if (!items[classType][item.bucket.hash][item.hash]) {
              items[classType][item.bucket.hash][item.hash] = [];
            }
            items[classType][item.bucket.hash][item.hash].push(item);
          }
        }
      }

      return items;
    }
  );

  return (state: RootState): StoreProps => {
    return {
      storesLoaded: storesLoadedSelector(state),
      stores: sortedStoresSelector(state),
      isPhonePortrait: state.shell.isPhonePortrait,
      items: itemsSelector(state),
      defs: state.manifest.d2Manifest,
      searchConfig: searchConfigSelector(state),
      filters: searchFiltersConfigSelector(state)
    };
  };
}

/**
 * The Loadout Optimizer screen
 */
export class LoadoutBuilder extends React.Component<Props & UIViewInjectedProps, State> {
  private storesSubscription: Subscription;
  private computeSetsMemoized = memoizeOne(computeSets);
  private filterSetsMemoized = memoizeOne(filterGeneratedSets);

  constructor(props: Props) {
    super(props);
    this.state = {
      requirePerks: true,
      lockedMap: {},
      statFilters: {
        Mobility: { min: 0, max: 10 },
        Resilience: { min: 0, max: 10 },
        Recovery: { min: 0, max: 10 }
      },
      minimumPower: 0,
      query: '',
      statOrder: ['Resilience', 'Recovery', 'Mobility']
    };
  }

  componentDidMount() {
    this.storesSubscription = D2StoresService.getStoresStream(this.props.account).subscribe(
      (stores) => {
        if (!stores) {
          return;
        }

        this.setState({ selectedStore: stores.find((s) => s.current) });

        if (!this.state.selectedStore) {
          this.onCharacterChanged(stores.find((s) => s.current)!.id);
        } else {
          const selectedStore = stores.find((s) => s.id === this.state.selectedStore!.id)!;
          this.setState({ selectedStore });
        }
      }
    );
  }

  componentWillUnmount() {
    this.storesSubscription.unsubscribe();
  }

  render() {
    const {
      storesLoaded,
      stores,
      isPhonePortrait,
      items,
      defs,
      searchConfig,
      filters
    } = this.props;
    const {
      lockedMap,
      selectedStore,
      statFilters,
      minimumPower,
      requirePerks,
      query,
      statOrder
    } = this.state;

    if (!storesLoaded || !defs) {
      return <Loading />;
    }

    let store = selectedStore;
    if (!store) {
      store = stores.find((s) => s.current)!;
    }

    if (!items[store.classType]) {
      return <Loading />;
    }

    const filter = filters.filterFunction(query);

    let processedSets: readonly ArmorSet[] = [];
    let filteredSets: readonly ArmorSet[] = [];
    let processError;
    try {
      processedSets = this.computeSetsMemoized(
        items,
        store.classType,
        requirePerks,
        lockedMap,
        filter
      );
      filteredSets = this.filterSetsMemoized(
        processedSets,
        minimumPower,
        lockedMap,
        statFilters,
        statOrder
      );
    } catch (e) {
      console.error(e);
      processError = e;
    }

    const menuContent = (
      <div className={styles.menuContent}>
        <SearchFilterInput
          searchConfig={searchConfig}
          placeholder={t('LoadoutBuilder.SearchPlaceholder')}
          onQueryChanged={this.onQueryChanged}
        />

        <FilterBuilds
          sets={processedSets}
          selectedStore={store as D2Store}
          minimumPower={minimumPower}
          stats={statFilters}
          onMinimumPowerChanged={this.onMinimumPowerChanged}
          onStatFiltersChanged={this.onStatFiltersChanged}
          defs={defs}
          order={statOrder}
          onStatOrderChanged={this.onStatOrderChanged}
        />

        <LockArmorAndPerks
          items={items}
          selectedStore={store}
          lockedMap={lockedMap}
          onLockedMapChanged={this.onLockedMapChanged}
        />
      </div>
    );

    return (
      <PageWithMenu className={styles.page}>
        <PageWithMenu.Menu className={styles.menu}>
          <CharacterSelect
            selectedStore={store}
            stores={stores}
            vertical={!isPhonePortrait}
            isPhonePortrait={isPhonePortrait}
            onCharacterChanged={this.onCharacterChanged}
          />
          {isPhonePortrait ? (
            <CollapsibleTitle sectionId="lb-filter" title={t('LoadoutBuilder.Filter')}>
              {menuContent}
            </CollapsibleTitle>
          ) : (
            menuContent
          )}
        </PageWithMenu.Menu>

        <PageWithMenu.Contents>
          {processError ? (
            <div className="dim-error">
              <h2>{t('ErrorBoundary.Title')}</h2>
              <div>{processError.message}</div>
            </div>
          ) : processedSets.length === 0 && requirePerks ? (
            <>
              <h3>{t('LoadoutBuilder.NoBuildsFound')}</h3>
              <button className="dim-button" onClick={this.setRequiredPerks}>
                {t('LoadoutBuilder.RequirePerks')}
              </button>
            </>
          ) : (
            <GeneratedSets
              sets={filteredSets}
              lockedMap={lockedMap}
              selectedStore={store}
              onLockChanged={this.updateLockedArmor}
              defs={defs}
              statOrder={statOrder}
            />
          )}
        </PageWithMenu.Contents>

        <LoadoutDrawer />
      </PageWithMenu>
    );
  }

  /**
   * Recomputes matched sets and includes items without additional perks
   */
  private setRequiredPerks = () => {
    this.setState({ requirePerks: false });
  };

  /**
   * Handle when selected character changes
   * Recomputes matched sets
   */
  private onCharacterChanged = (storeId: string) => {
    const selectedStore = this.props.stores.find((s) => s.id === storeId)!;
    this.setState({
      selectedStore,
      lockedMap: {},
      requirePerks: true,
      statFilters: {
        Mobility: { min: 0, max: 10 },
        Resilience: { min: 0, max: 10 },
        Recovery: { min: 0, max: 10 }
      },
      minimumPower: 0
    });
  };

  private onStatFiltersChanged = (statFilters: State['statFilters']) =>
    this.setState({ statFilters });

  private onMinimumPowerChanged = (minimumPower: number) => this.setState({ minimumPower });

  private onQueryChanged = (query: string) => this.setState({ query });

  private onStatOrderChanged = (statOrder: StatTypes[]) => this.setState({ statOrder });

  private onLockedMapChanged = (lockedMap: State['lockedMap']) => this.setState({ lockedMap });

  /**
   * Adds an item to the locked map bucket
   */
  private updateLockedArmor = (bucket: InventoryBucket, locked: LockedItemType[]) =>
    this.setState((state) => ({ lockedMap: { ...state.lockedMap, [bucket.hash]: locked } }));
}

export default connect<StoreProps>(mapStateToProps)(LoadoutBuilder);
