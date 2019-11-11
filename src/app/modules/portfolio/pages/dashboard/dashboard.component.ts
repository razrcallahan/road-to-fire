import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';

import { EventsService, AppEvent, AppEventType } from 'src/app/core/services/events.service';
import { PortfolioService } from '../../services/portfolio.service';
import { PortfolioAccount } from '../../models/portfolio-account';
import { LoggerService } from 'src/app/core/services/logger.service';
import { PortfolioPageComponent } from '../../components/portfolio-page/portfolio-page.component';
import {
  Asset, ASSET_TYPE_LABELS, AssetType
} from '../../models/asset';
import { DialogsService } from 'src/app/modules/dialogs/dialogs.service';
import { Dictionary, NumKeyDictionary } from 'src/app/shared/models/dictionary';
import { AssetManagementService } from '../../services/asset-management.service';
import { StorageService } from 'src/app/core/services/storage.service';
import { TradeableAsset } from '../../models/tradeable-asset';
import { DashboardGridTileEditorComponent } from '../../components/dashboard-grid-tile-editor/dashboard-grid-tile-editor.component';
import { DashboardGridTiles } from '../../models/dashboard-grid-tiles';
import { PortfolioHistoryEntry, PortfolioAssetValue, PortfolioHistory } from '../../models/portfolio-history';
import { getCurrencySymbol } from '@angular/common';
import {
  PortfolioHistoryAddComponent, PortfolioHistoryAddComponentInput
} from '../../components/portfolio-history-add/portfolio-history-add.component';
import { FloatingMath, binarySearch, DateUtils } from 'src/app/shared/util';
import { ASSET_REGION_LABELS, AssetRegionHelper } from '../../models/asset-region';

interface ChartDataSets {
  label: string;
  data: number[];
  backgroundColor?: any;
  borderColor?: any;
  lineTension?: number;
}

interface ChartContext {
  labels: string[];
  data: number[];
}

interface MultiDatasetChartContext {
  labels: string[];
  data: ChartDataSets[];
}

interface RebalanceStep {
  percentage: number;
  value: number;
  assetName: string;
}

interface AssetRegionsValue {
  [id: number]: NumKeyDictionary<number>;
}

interface AssetValue {
  assetTitle: string;
  value: number;

}

interface AssetTypeAllocationMap {
  [id: number]: Dictionary<AssetValue>;
}

interface AssetCurrencyValueMap {
  [id: number]: Dictionary<number>;
}

const PERCENT_TOOLTIPS = {
  callbacks: {
    label: function (tooltipItem, data) {
      let label = '';
      if (data.labels[tooltipItem.index]) {
        label += data.labels[tooltipItem.index] + ': ';
      }
      label += data.datasets[tooltipItem.datasetIndex].data[tooltipItem.index] + '%';
      return label;
    }
  }
};

interface DatasetEntries {
  empty: boolean;
  data: number[];
}



/**
 * Component to display a page with a summary of the users's portfolio, including:
 * - percentage of goals completed
 * - portfolio allocation by assets
 * - bonds geographic allocation
 * - stocks geographic allocation
 * - cryptocurrencies allocation
 * - commodities allocation
 * - cash allocation by currency
 * - steps needed to be done to rebalance portfolio
 */
@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent extends PortfolioPageComponent implements OnInit {

  assetRegions: AssetRegionsValue = {};
  assetsTotalValue: Dictionary<number> = {};
  currenciesTotalValue: Dictionary<number> = {};
  assetCurrenciesValue: AssetCurrencyValueMap = {};
  assetTypeAllocationMap: AssetTypeAllocationMap = {};
  accounts: PortfolioAccount[];
  dataLoaded = false;
  goals: ChartDataSets[] = [];
  goalsDatasets: ChartDataSets[] = [{ label: '1', data: [90, 10] }, { label: '2', data: [50, 50] }, { label: '2', data: [10, 90] }];
  monthlySpendLimit: number;
  portfolioValue: number;
  rebalancingSetup: boolean;
  rebalancingSteps: RebalanceStep[] = [];
  assetAllocationChart: ChartContext = { data: [], labels: [] };
  stockGeoAllocationChart: ChartContext = { data: [], labels: [] };
  bondGeoAllocationChart: ChartContext = { data: [], labels: [] };
  cryptoAllocationChart: ChartContext = { data: [], labels: [] };
  commodityAllocationChart: ChartContext = { data: [], labels: [] };
  cashAllocationChart: ChartContext = { data: [], labels: [] };
  currencyAllocationChart: ChartContext = { data: [], labels: [] };
  stockCurrencyAllocationChart: ChartContext = { data: [], labels: [] };
  bondCurrencyAllocationChart: ChartContext = { data: [], labels: [] };
  portfolioHistoryChart: MultiDatasetChartContext = { data: [{ label: '', data: [] }], labels: [] };
  gridVisibility: Dictionary<boolean>;
  phTimeFrame = 'Max';

  readonly assetTypeLabels = { ...ASSET_TYPE_LABELS };
  readonly goalChartColors: Array<any> = ['rgb(51, 160, 223)', 'rgba(214, 214, 214, 0.897)'];
  readonly goalChartLabels: string[] = ['Completed', 'Remaining'];
  readonly GridTiles = DashboardGridTiles;
  readonly goalChartOptions = {
    legend: {
      display: false
    },
    tooltips: {
      callbacks: {
        label: function (tooltipItem, data) {
          let label = '';
          if (data.datasets[tooltipItem.datasetIndex].label) {
            label += data.datasets[tooltipItem.datasetIndex].label + ' ';
          }
          if (data.labels[tooltipItem.index]) {
            label += data.labels[tooltipItem.index] + ': ';
          }
          label += data.datasets[tooltipItem.datasetIndex].data[tooltipItem.index] + '%';
          return label;
        }
      }
    },

    circumference: Math.PI,
    rotation: -Math.PI
  };
  pieChartOptions = {
    tooltips: PERCENT_TOOLTIPS,
  };
  readonly portfolioHistoryChartOptions = {
    responsive: true,
    tooltips: {
      mode: 'index',
      callbacks: {
        label: (tooltipItem: any, data: any) => {
          let totalValue = 0;
          for (let i = 0; i < data.datasets.length; i++) {
            totalValue += data.datasets[i].data[tooltipItem.index];
          }
          let label = data.datasets[tooltipItem.datasetIndex].label || '';

          if (label) {
            label += ': ';
          }
          const value = data.datasets[tooltipItem.datasetIndex].data[tooltipItem.index];
          label += this.baseCurrencySymbol + value.toLocaleString();
          if (tooltipItem.datasetIndex !== data.datasets.length - 1) {
            return label;
          } else {
            return [label, 'Total: ' + this.baseCurrencySymbol + totalValue.toLocaleString()];
          }
        }
      }
    },
    hover: {
      mode: 'index'
    },
    scales: {
      xAxes: [{
        type: 'time',
        distribution: 'linear',
        time: {
          tooltipFormat: 'MMM D YYYY',
        }
      }],
      yAxes: [{
        stacked: true,
        ticks: {
          callback: (value: any, index: any, values: any) => {
            return this.baseCurrencySymbol + value.toLocaleString();
          }
        }
      }]
    },
  };

  private allPortfolioHistory: PortfolioHistory;
  private refreshTimer: any;
  private baseCurrencySymbol: string;


  constructor(protected eventsService: EventsService, protected portfolioService: PortfolioService,
    protected logger: LoggerService, protected dialogService: DialogsService, protected router: Router,
    protected assetManagementService: AssetManagementService,
    protected storageService: StorageService, private cdr: ChangeDetectorRef) {
    super(logger, portfolioService, dialogService, eventsService, router, storageService);
    this.assetTypeLabels[AssetType.Cash] = 'Cash & Equivalents';
    this.assetTypeLabels[AssetType.Bond] = 'Bonds & Bond ETFs';
    this.assetTypeLabels[AssetType.Commodity] = 'Commodities & Commodity ETFs';
  }

  ngOnInit() {
    super.ngOnInit();
  }

  gridColsChanged() {
    this.cdr.markForCheck();
  }

  /**
   * Prompt user to manually add the value of the portfolio for a given date and store the result.
   */
  async addPortfolioHistory() {
    const history = await this.portfolioService.getPortfolioHistory();
    const data: PortfolioHistoryAddComponentInput = {
      baseCurrency: this.baseCurrency,
      portfolioHistoryEntries: history.entries,
    };
    const newEntry: PortfolioHistoryEntry = await this.dialogService.showAdaptableScreenModal(PortfolioHistoryAddComponent, data);
    if (newEntry) {
      // we keep the entries sorted by date, so we can do a binary search
      const insertIndex = binarySearch<PortfolioHistoryEntry>(history.entries, newEntry,
        (a: PortfolioHistoryEntry, b: PortfolioHistoryEntry) => {
          return DateUtils.compareDates(new Date(a.date), new Date(b.date));
        }, true);
      if (insertIndex >= history.entries.length) {
        history.entries.push(newEntry);
      } else if (history.entries[insertIndex].date === newEntry.date) {
        // replace entry
        history.entries[insertIndex] = newEntry;
      } else {
        // insert
        history.entries.splice(insertIndex, 0, newEntry);
      }
      // no need to wait for saving
      this.portfolioService.savePortfolioHistory(history);
      this.allPortfolioHistory = history;
      this.logger.info('Edited portfolio history entry!');
      this.displayPortfolioHistory();
    }
  }

  async changeDisplaySettings() {
    await this.dialogService.showModal(DashboardGridTileEditorComponent, this.gridVisibility, false);
    this.portfolioConfig.dashboardGridVisibility = this.gridVisibility;
    this.portfolioService.saveConfig(this.portfolioConfig);
    this.cdr.markForCheck();
  }

  onPhTimeFrameChanged(newTimeFrame: string) {
    this.phTimeFrame = newTimeFrame;
    this.displayPortfolioHistory();
  }

  protected handleEvents(event: AppEvent) {
    switch (event.type) {
      case AppEventType.ACCOUNT_ADDED:
      case AppEventType.ACCOUNT_REMOVED:
      case AppEventType.ACCOUNT_UPDATED:
      case AppEventType.ASSET_ADDED:
      case AppEventType.ASSET_REMOVED:
      case AppEventType.ASSET_UPDATED:
        this.onDataUpdated();
        break;
      default:
        super.handleEvents(event);
    }
  }

  /**
   * Triggered when an update in an asset or account occurs, and data needs to be reloaded
   */
  private onDataUpdated() {
    // refresh data using a timer, so if multiple updates occur at once, only trigger reloading once
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.loadData();
    }, 1000);
  }

  /**
   * Calculate the completed percentage of each goal set.
   */
  private computeGoals() {
    this.goals = [];
    for (const goal of this.portfolioConfig.goals) {
      if (goal.value > 0) {
        const pDone = FloatingMath.round2Decimals(Math.min(100, this.portfolioValue / goal.value * 100));
        this.goals.push({
          label: goal.title,
          data: [pDone, FloatingMath.round2Decimals(100 - pDone)],
          backgroundColor: this.goalChartColors,
        });
      }
    }
  }

  /**
   * Return the percentage of a value from a total value
   */
  private toPercentage(value: number, totalValue: number) {
    return FloatingMath.round2Decimals(value / totalValue * 100);
  }

  /**
   * Takes a dictionary with numeric values and returns [key,value] tuple array sorted by value in descending order
   * @param map a dictionary with numeric values
   */
  private sortNumDict(map: Dictionary<number> | NumKeyDictionary<number>): [string, number][] {
    const result: [string, number][] = [];
    for (const key of Object.keys(map)) {
      result.push([key, map[key]]);
    }
    result.sort((a, b) => b[1] - a[1]);
    return result;
  }

  /**
   * Build the chart data for the allocation percentage of each asset out of the total portfolio value
   */
  private computeAssetAllocationData() {
    this.assetAllocationChart.data = [];
    this.assetAllocationChart.labels = [];
    const assetAllocations = this.sortNumDict(this.assetsTotalValue);
    for (const [assetType, value] of assetAllocations) {
      this.assetAllocationChart.labels.push(this.assetTypeLabels[assetType]);
      this.assetAllocationChart.data.push(this.toPercentage(value, this.portfolioValue));
    }
  }

  /**
   * Build the chart data for the allocation percentage of each currency out of the total portfolio value
   */
  private computeCurrenciesAllocationData() {
    this.currencyAllocationChart.data = [];
    this.currencyAllocationChart.labels = [];
    const currencyAllocations = this.sortNumDict(this.currenciesTotalValue);
    for (const [currency, value] of currencyAllocations) {
      this.currencyAllocationChart.labels.push(currency);
      this.currencyAllocationChart.data.push(this.toPercentage(value, this.portfolioValue));
    }
  }

  /**
   * Build the chart data for the currency allocation of a specific asset type.
   * @param chart chart context
   * @param assetType asset type
   */
  private computeAssetCurrencyAllocationData(chart: ChartContext, assetType: AssetType) {
    chart.data = [];
    chart.labels = [];

    const assetCurrenciesValue = this.assetCurrenciesValue[assetType];
    if (assetCurrenciesValue) {
      const totalValue = this.assetsTotalValue[assetType];
      const currencyAllocations = this.sortNumDict(assetCurrenciesValue);
      for (const [currency, value] of currencyAllocations) {
        chart.labels.push(currency);
        chart.data.push(this.toPercentage(value, totalValue));
      }
    }
  }

  /**
   * Build the chart data for the allocation of a specific asset type.
   * @param chart chart context
   * @param assetType asset type
   */
  private computeAssetTypeAllocationData(chart: ChartContext, assetType: AssetType) {
    chart.data = [];
    chart.labels = [];
    const allocation = this.assetTypeAllocationMap[assetType];
    const totalValue = this.assetsTotalValue[assetType];
    // we use a tuple array to hold data so we can sort it
    const typeAllocations: [string, number][] = [];
    if (allocation) {
      for (const assetId of Object.keys(allocation)) {
        const assetValue = allocation[assetId];
        typeAllocations.push([
          assetValue.assetTitle,
          this.toPercentage(assetValue.value, totalValue)
        ]);
      }
      typeAllocations.sort((a, b) => b[1] - a[1]);
      for (const [assetTitle, value] of typeAllocations) {
        chart.data.push(value);
        chart.labels.push(assetTitle);
      }

    }
  }

  /**
   * Build the chart data for the geographic allocation of a specific asset type
   * @param chart chart context
   * @param assetType asset type
   */
  private computeAssetGeoAllocationData(chart: ChartContext, assetType: AssetType) {
    chart.data = [];
    chart.labels = [];
    const regionsValues = this.assetRegions[assetType];
    if (regionsValues) {
      const regionArr = this.sortNumDict(regionsValues);
      for (const [regionId, value] of regionArr) {
        chart.labels.push(ASSET_REGION_LABELS[regionId]);
        chart.data.push(this.toPercentage(value, this.assetsTotalValue[assetType]));
      }
    }
  }

  /**
   * Go through entire asset allocation, and compute what assets need to be
   * bought/sold in order to have the desired portfolio allocation
   */
  private computeRebalanceSteps() {
    this.rebalancingSteps = [];
    const desiredAllocations = {};
    for (const allocation of this.portfolioConfig.portfolioAllocation) {
      desiredAllocations[allocation.assetType] = allocation.allocation;
    }
    for (const assetType in this.assetsTotalValue) {
      if (!Asset.isCashLike(+assetType)) { // we can't buy/sell cash
        const assetPercentageValue = this.assetsTotalValue[assetType] / this.portfolioValue;
        const dif = (desiredAllocations[assetType] || 0) - assetPercentageValue;
        if (dif !== 0) { // only add assets that need rebalancing
          const transactionValue = dif * this.portfolioValue;
          this.rebalancingSteps.push({
            assetName: this.assetTypeLabels[assetType],
            percentage: transactionValue / this.assetsTotalValue[assetType],
            value: transactionValue
          });
        }
      }
    }
    this.rebalancingSteps.sort((a, b) => {
      return a.value < b.value ? -1 : 1;
    });
  }


  /**
   * Compute all stats required for the dashboard page
   */
  private async computeStats() {
    this.portfolioValue = 0;
    this.requiredFXPairs = {};
    this.assetsTotalValue = {};
    this.currenciesTotalValue = {};
    this.assetCurrenciesValue = {};
    this.assetRegions = {};
    this.assetTypeAllocationMap = {};

    // check for any foreign currencies and queue them for quote update
    for (const account of this.accounts) {
      for (const asset of account.assets) {
        this.getCurrencyRate(asset.currency);
      }
    }
    await this.getForexRates();

    for (const account of this.accounts) {
      for (const asset of account.assets) {
        let assetIdKey = asset.description.toUpperCase();
        let assetDescription = asset.description;
        const rate: number = this.getCurrencyRate(asset.currency);
        const currentValue = asset.getCurrentValue();
        if (asset.isTradeable()) {
          const tradeableAsset = <TradeableAsset><Asset>asset;
          if (tradeableAsset.symbol) {
            const symbolParts = tradeableAsset.parseSymbol();
            assetIdKey = symbolParts.shortSymbol;
          }
        }
        const assetBaseCurrencyValue = currentValue * rate;
        this.portfolioValue += assetBaseCurrencyValue;

        if (!this.currenciesTotalValue[asset.currency]) {
          this.currenciesTotalValue[asset.currency] = 0;
        }
        this.currenciesTotalValue[asset.currency] += assetBaseCurrencyValue;


        const broadAssetType = asset.getBroadAssetType();
        if (Asset.isCashLike(broadAssetType)) {
          assetIdKey = asset.currency;
          assetDescription = asset.currency;
        }

        if (!this.assetsTotalValue[broadAssetType]) {
          this.assetsTotalValue[broadAssetType] = 0;
        }
        this.assetsTotalValue[broadAssetType] += assetBaseCurrencyValue;

        if (!this.assetCurrenciesValue[broadAssetType]) {
          this.assetCurrenciesValue[broadAssetType] = {};
        }
        const assetCurrenciesValue = this.assetCurrenciesValue[broadAssetType];
        if (!assetCurrenciesValue[asset.currency]) {
          assetCurrenciesValue[asset.currency] = 0;
        }
        assetCurrenciesValue[asset.currency] += assetBaseCurrencyValue;

        // total allocation for each asset grouped by asset type
        let assetTypeAllocation = this.assetTypeAllocationMap[broadAssetType];
        if (!assetTypeAllocation) {
          assetTypeAllocation = {};
          this.assetTypeAllocationMap[broadAssetType] = assetTypeAllocation;
        }
        if (!assetTypeAllocation[assetIdKey]) {
          assetTypeAllocation[assetIdKey] = {
            assetTitle: assetDescription,
            value: 0,
          };
        }
        assetTypeAllocation[assetIdKey].value += assetBaseCurrencyValue;

        if (Asset.isStockLike(broadAssetType) || Asset.isBondLike(broadAssetType)) {
          const regionWeights = (<TradeableAsset>asset).getRegionWeights();

          let assetRegionValues: NumKeyDictionary<number> = this.assetRegions[broadAssetType];
          if (!assetRegionValues) {
            assetRegionValues = {};
            this.assetRegions[broadAssetType] = assetRegionValues;
          }
          for (const regWeight of regionWeights) {
            const regionId = AssetRegionHelper.getClassificationRegion(regWeight.region);
            if (!assetRegionValues[regionId]) {
              assetRegionValues[regionId] = 0;
            }
            assetRegionValues[regionId] += assetBaseCurrencyValue * regWeight.weight;
          }
        }
      }
    }

    this.monthlySpendLimit = this.portfolioConfig.withdrawalRate * this.portfolioValue / 12;

    this.computeGoals();
    this.computeAssetAllocationData();
    this.computeCurrenciesAllocationData();
    this.computeAssetCurrencyAllocationData(this.stockCurrencyAllocationChart, AssetType.Stock);
    this.computeAssetCurrencyAllocationData(this.bondCurrencyAllocationChart, AssetType.Bond);
    this.computeAssetGeoAllocationData(this.stockGeoAllocationChart, AssetType.Stock);
    this.computeAssetGeoAllocationData(this.bondGeoAllocationChart, AssetType.Bond);
    this.computeAssetTypeAllocationData(this.cryptoAllocationChart, AssetType.Cryptocurrency);
    this.computeAssetTypeAllocationData(this.commodityAllocationChart, AssetType.Commodity);
    this.computeAssetTypeAllocationData(this.cashAllocationChart, AssetType.Cash);
    this.computeRebalanceSteps();
    this.computePortfolioHistory();
  }

  onDataLoaded() {
    this.dataLoaded = true;
    this.cdr.markForCheck();
  }

  /**
   * Get the historic value of the portfolio, and if today's current portfolio value hasn't been stored
   * already, compute and store it. If we already have today's portfolio value, only update if value has
   * changed.
   */
  private async computePortfolioHistory() {
    let history = await this.portfolioService.getPortfolioHistory();
    let updateEntries = true;
    let replaceToday = false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (history) {
      // check if we need to add today's portfolio value
      if (history.entries.length > 0) {
        const latestEntry = history.entries[history.entries.length - 1];
        const entryDate = new Date(latestEntry.date);
        entryDate.setHours(0, 0, 0, 0);
        if (today.getTime() === entryDate.getTime()) {

          if (latestEntry.value !== this.portfolioValue) {
            replaceToday = true;
          } else {
            // same portfolio data for today, no need for update
            updateEntries = false;
          }
        }
      }
    } else {
      history = { entries: [] };
    }

    if (updateEntries) {
      // create new entry for the current day and add all asset types and their total values
      const entry: PortfolioHistoryEntry = {
        date: today.toISOString(),
        value: this.portfolioValue,
        assets: [],
      };

      for (const assetType of Object.keys(this.assetsTotalValue)) {
        const value = this.assetsTotalValue[assetType];
        const asset: PortfolioAssetValue = {
          type: +assetType,
          value: value,
        };
        entry.assets.push(asset);
      }
      if (replaceToday) {
        history.entries[history.entries.length - 1] = entry;
      } else {
        history.entries.push(entry);
      }

      // no need to wait for saving
      this.portfolioService.savePortfolioHistory(history);
    }
    this.allPortfolioHistory = history;
    this.displayPortfolioHistory();
  }

  /**
   * Prepare the data for the portfolio history chart
   * @param history portfolio history data
   */
  private displayPortfolioHistory() {
    const history = this.allPortfolioHistory;
    const chartLabels: string[] = [];
    this.portfolioHistoryChart.data.splice(0);
    const dataSets: NumKeyDictionary<DatasetEntries> = {};
    for (const assetType of Object.keys(this.assetTypeLabels)) {
      dataSets[assetType] = {
        empty: true,
        data: [],
      };
    }

    let minDate: Date;
    switch (this.phTimeFrame) {
      case 'YTD':
        minDate = new Date();
        minDate.setMonth(0, 1);
        break;
      case '1Y':
        minDate = new Date();
        minDate.setFullYear(minDate.getFullYear() - 1);
        break;
      case '5Y':
        minDate = new Date();
        minDate.setFullYear(minDate.getFullYear() - 5);
        break;
      case '10Y':
        minDate = new Date();
        minDate.setFullYear(minDate.getFullYear() - 10);
        break;
    }
    if (minDate) {
      minDate.setHours(0, 0, 0, 0);
    }

    for (const entry of history.entries) {
      const entryDate = new Date(entry.date);
      // skip dates not in our time frame
      if (!minDate || minDate.getTime() <= entryDate.getTime()) {
        for (const assetType of Object.keys(this.assetTypeLabels)) {
          dataSets[assetType].data.push(0); // initialize all asset portfolio values with 0 for the current entry day
        }

        for (const asset of entry.assets) {
          dataSets[asset.type].empty = false; // we have data for this asset so we need to display it
          const data = dataSets[asset.type].data;
          data[data.length - 1] = asset.value;
        }
        const dateStr = entryDate.toISOString();
        chartLabels.push(dateStr);
      }
    }
    // push non-empty datasets (assets)
    for (const assetType of Object.keys(this.assetTypeLabels)) {
      if (!dataSets[assetType].empty) {
        this.portfolioHistoryChart.data.push({
          data: dataSets[assetType].data,
          label: this.assetTypeLabels[assetType],
          lineTension: 0,
        });
      }
    }

    this.portfolioHistoryChart.labels = chartLabels;
    this.cdr.markForCheck();
  }

  /**
   * Loads the portfolio data and computes the stats
   */
  private loadData() {
    this.portfolioService.getAccounts()
      .then(
        accounts => {
          this.accounts = accounts;
          this.computeStats()
            .then(() => this.onDataLoaded());
        })
      .catch(err => {
        this.onDataLoaded();
        this.logger.error('Could not retrieve accounts!', err);
      });
  }

  protected onConfigLoaded() {
    super.onConfigLoaded();

    this.baseCurrency = this.portfolioConfig.baseCurrency;
    this.baseCurrencySymbol = getCurrencySymbol(this.baseCurrency, 'wide');
    this.rebalancingSetup = this.portfolioConfig.portfolioAllocation.length > 0;
    this.gridVisibility = this.portfolioConfig.dashboardGridVisibility;
    if (!this.gridVisibility) {
      this.gridVisibility = {};
      for (const tile of Object.keys(DashboardGridTiles)) {
        this.gridVisibility[tile] = true;
      }
    }
    this.loadData();
  }
}
