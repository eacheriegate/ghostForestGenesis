// This code calculates monthly mean NDVI values for time series analysis using Landsat sensors and imported region of interest (ROI) with Google Earth Engine in JavaScript //

// Add ROI Shapefile to the map. Rename VAR Shapefile as 'ROI'. 
Map.addLayer(ROI, {}, 'ROI');

// Load or import the Hansen et al. forest change dataset ('UMD/hansen/global_forest_change_2015') for water classification
var hansenImage = ee.Image('UMD/hansen/global_forest_change_2015');

// Specify the start date, 1st day of Month (Year, Month, Day)
var startDate = ee.Date.fromYMD(2014,1,1);

// Cloud mask function 
function cloud_mask(image) {
  // Bits 3 and 5 are cloud shadow and cloud, respectively.
  var cloudShadowBitMask = 1 << 3;
  var cloudsBitMask = 1 << 5;
  // Get the pixel QA band.
  var qa = image.select('QA_PIXEL');
  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
    .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  // Return the masked image, scaled to reflectance, without the QA bands.
  return image.updateMask(mask)
    .copyProperties(image, ["system:time_start"]);
}

// Scale factors function
function applyScaleFactors(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  return image.addBands(opticalBands, null, true)
    .addBands(thermalBands, null, true);
}

// Create an empty feature collection to store the monthly mean NDVI
var monthlyMeanNDVI = ee.FeatureCollection([]);


// Select the land/water mask.
var datamask = hansenImage.select('datamask');

// Create a binary mask where land has value 1 and water or 'no data' has value 0.
var mask = datamask.eq(1);

// Function to apply water mask
function applyWaterMask(image) {
  return image.updateMask(mask);
}

// Iterate over each month from the start date over 12 months
for (var i = 0; i < 12; i++) {
  // Calculate the end date for each month
  var endDate = startDate.advance(1, 'month');

  // Create cloud-free Landsat 8 Collection 2 Tier 2 for the current month or other NASA EO Dataset Imported
  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(ROI)
    .filterDate(startDate, endDate)
    .map(cloud_mask)
    .map(applyScaleFactors)
    .map(applyWaterMask) // Apply water mask
    .median()
    .clip(ROI);

  // Calculate NDVI for the current month
  var ndvi = l8.addBands(
    l8.expression(
      '(NIR - RED) / (NIR + RED)',
      {
        'NIR': l8.select('SR_B5'),
        'RED': l8.select('SR_B4')
      }
    ).rename('NDVI')
  ).select('NDVI');

  // Clip NDVI data to ROI
  var ndvi_clip = ndvi.clip(ROI);

  // Calculate mean NDVI for the current month
  var meanNDVI = ndvi_clip.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: ROI,
    scale: 100
  });

  // Create a feature with the mean NDVI value and month as properties
  var feature = ee.Feature(null, {
    month: i + 1,
    meanNDVI: meanNDVI.get('NDVI')
  });

  // Add the water mask to the feature
  feature = feature.set('waterMask', mask);

  // Add the feature to the monthly mean NDVI collection
  monthlyMeanNDVI = monthlyMeanNDVI.merge(ee.FeatureCollection([feature]));

  // Visualize the NDVI for the current month with water pixels masked out
  var visParams = { min: -1, max: 1, palette: ['blue', 'white', 'green'] };
  Map.addLayer(ndvi, visParams, 'NDVI - Month ' + (i + 1));

  // Update the start date for the next iteration
  startDate = endDate;

  // Export each month as a GeoTIFF file
  var exportNameMonth = 'NDVI_Month' + (i + 1);
  Export.image.toDrive({
    image: ndvi,
    description: exportNameMonth,
    folder: 'Month_Export',
    fileNamePrefix: exportNameMonth,
    region: ROI.geometry(),
    scale: 30,
    fileFormat: 'GeoTIFF'
  });
}

// Export mean NDVI data as a CSV file to Google Drive
Export.table.toDrive({
  collection: monthlyMeanNDVI,
  description: 'mean_NDVI_by_month',
  fileFormat: 'CSV'
});

// Zoom to Layer
Map.centerObject(ROI, 11);
